import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { accountApi, googleCalendarApi, GoogleCalendarSyncStatus, type NativeMfaCapability } from '../services/api';
import { useAuth } from './AuthContext';

export type ConnectionProvider = 'google' | 'discord';

export interface AccountProfile {
  display_name: string;
  full_name: string;
  profile_picture: string | null;
  email?: string;
  created_at?: string;
  preferences?: {
    onboarding_required?: boolean;
    onboarding_version?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ConnectionDetails {
  connected: boolean;
  available?: boolean;
  disconnect_allowed?: boolean;
  display_name?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

export interface AccountConnections {
  google?: boolean | ConnectionDetails;
  discord?: boolean | ConnectionDetails;
  [key: string]: boolean | ConnectionDetails | undefined;
}

export interface AccountData {
  profile: AccountProfile;
  connections: AccountConnections;
  password_change_available: boolean;
  native_mfa: NativeMfaCapability;
  calendar_sync: GoogleCalendarSyncStatus;
}

interface ProfileUpdate {
  display_name: string;
  full_name: string;
  profile_picture_upload_key?: string | null;
}

interface AccountContextValue extends AccountData {
  loading: boolean;
  error: string;
  refreshAccount: () => Promise<void>;
  updateProfile: (profile: ProfileUpdate) => Promise<void>;
  completeOnboarding: (version: number) => Promise<void>;
  connect: (provider: ConnectionProvider) => Promise<void>;
  completeOAuth: (code: string, state: string) => Promise<void>;
  cancelOAuth: (state: string) => Promise<void>;
  disconnect: (provider: ConnectionProvider) => Promise<void>;
  deleteAccount: (confirmation: string) => Promise<void>;
  enableCalendarSync: () => Promise<void>;
  syncCalendarNow: () => Promise<void>;
  disableCalendarSync: () => Promise<void>;
  isConnected: (provider: ConnectionProvider) => boolean;
}

const emptyConnections: AccountConnections = { google: false, discord: false };
const emptyCalendarSync: GoogleCalendarSyncStatus = {
  linked: false,
  available: false,
  enabled: false,
  status: 'disabled',
};
const emptyNativeMfa: NativeMfaCapability = {
  available: false,
  totp_available: false,
  email_available: false,
  provider_managed: null,
};
const AccountContext = createContext<AccountContextValue | undefined>(undefined);

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } }).response;
    return response?.data?.error || response?.data?.message || 'Unable to update account.';
  }
  if (error instanceof Error) {
    if (error.message.toLowerCase() === 'network error') {
      return 'Unable to reach the service. Check your connection and try again.';
    }
    return error.message;
  }
  return 'Unable to update account.';
}

function hasProviderIdentity(
  user: ReturnType<typeof useAuth>['user'],
  provider: ConnectionProvider,
): boolean {
  if (!user) return false;
  const normalizedProvider = provider.toLowerCase();
  const cognitoUsername = user['cognito:username'];
  if (
    typeof cognitoUsername === 'string'
    && cognitoUsername.toLowerCase().startsWith(`${normalizedProvider}_`)
  ) return true;

  try {
    const identities = typeof user.identities === 'string' ? JSON.parse(user.identities) : user.identities;
    return Array.isArray(identities) && identities.some((identity) => (
      typeof identity?.providerName === 'string'
      && identity.providerName.toLowerCase() === normalizedProvider
    ));
  } catch {
    return false;
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, updateUserAttributes, refreshSession } = useAuth();
  const claimDisplayName = user?.preferred_username || user?.name || user?.username || user?.email?.split('@')[0] || 'User';
  const [profile, setProfile] = useState<AccountProfile>({
    display_name: claimDisplayName,
    full_name: user?.name || '',
    profile_picture: null,
    email: user?.email,
  });
  const [connections, setConnections] = useState<AccountConnections>(emptyConnections);
  const [calendarSync, setCalendarSync] = useState<GoogleCalendarSyncStatus>(emptyCalendarSync);
  const [passwordChangeAvailable, setPasswordChangeAvailable] = useState(false);
  const [nativeMfa, setNativeMfa] = useState<NativeMfaCapability>(emptyNativeMfa);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const applyAccountData = useCallback((data: Partial<AccountData> | undefined) => {
    if (!data) return;
    if (data.profile) {
      setProfile((current) => ({ ...current, ...data.profile }));
    }
    if (data.connections) {
      setConnections({ ...emptyConnections, ...data.connections });
    }
    if (typeof data.password_change_available === 'boolean') {
      setPasswordChangeAvailable(data.password_change_available);
    }
    if (data.native_mfa) {
      setNativeMfa(data.native_mfa);
    }
    if (data.calendar_sync) {
      setCalendarSync(data.calendar_sync);
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [accountResult, calendarResult] = await Promise.allSettled([
        accountApi.get(),
        googleCalendarApi.get(),
      ]);
      if (accountResult.status === 'fulfilled') {
        applyAccountData(accountResult.value.data.data);
      }
      if (calendarResult.status === 'fulfilled') {
        setCalendarSync(calendarResult.value.data.data.calendar_sync);
      }
    } finally {
      setLoading(false);
    }
  }, [applyAccountData, user]);

  useEffect(() => {
    if (user) {
      setProfile({
        display_name: claimDisplayName,
        full_name: user.name || '',
        profile_picture: null,
        email: user.email,
      });
      setConnections(emptyConnections);
      setCalendarSync(emptyCalendarSync);
      setPasswordChangeAvailable(false);
      setNativeMfa(emptyNativeMfa);
      void refreshAccount();

    } else {
      setProfile({ display_name: 'User', full_name: '', profile_picture: null });
      setConnections(emptyConnections);
      setCalendarSync(emptyCalendarSync);
      setPasswordChangeAvailable(false);
      setNativeMfa(emptyNativeMfa);
    }
  }, [claimDisplayName, refreshAccount, user]);

  useEffect(() => {
    if (!user || !profile.profile_picture) return undefined;
    let cancelled = false;
    const refreshProfileUrl = async () => {
      try {
        const response = await accountApi.get();
        if (!cancelled) applyAccountData(response.data.data);
      } catch {
        // Keep the current profile and retry on the next interval or focus event.
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshProfileUrl();
    };
    const timer = window.setInterval(() => void refreshProfileUrl(), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [applyAccountData, profile.profile_picture, user]);

  const updateProfile = useCallback(async (nextProfile: ProfileUpdate) => {
    setError('');
    const response = await accountApi.updateProfile(nextProfile);
    applyAccountData(response.data.data);

    const attributes = [
      ...(nextProfile.display_name ? [{ Name: 'preferred_username', Value: nextProfile.display_name }] : []),
      ...(nextProfile.full_name ? [{ Name: 'name', Value: nextProfile.full_name }] : []),
    ];
    if (attributes.length && passwordChangeAvailable) {
      try {
        await updateUserAttributes(attributes);
        await refreshSession();
      } catch (attributeError) {
        throw new Error(`Profile saved, but Cognito attributes could not be refreshed: ${errorMessage(attributeError)}`);
      }
    }
  }, [applyAccountData, passwordChangeAvailable, refreshSession, updateUserAttributes]);

  const completeOnboarding = useCallback(async (version: number) => {
    setError('');
    const response = await accountApi.completeOnboarding(version);
    applyAccountData(response.data.data);
  }, [applyAccountData]);

  const connect = useCallback(async (provider: ConnectionProvider) => {
    setError('');
    try {
      const response = await accountApi.oauthAuthorize(provider);
      const data = response.data.data;
      const authorizationUrl = data.authorization_url || data.url;
      if (!authorizationUrl) throw new Error('The connection service did not return an authorization URL.');
      window.location.assign(authorizationUrl);
    } catch (requestError) {
      throw new Error(errorMessage(requestError));
    }
  }, []);

  const completeOAuth = useCallback(async (code: string, state: string) => {
    setError('');
    try {
      if (state.startsWith('calendar.')) {
        const response = await googleCalendarApi.callback(code, state);
        setCalendarSync(response.data.data.calendar_sync);
      } else {
        const response = await accountApi.oauthCallback(code, state);
        applyAccountData(response.data.data);
        try {
          await refreshSession();
        } catch {
          // Linking is already complete; account data remains authoritative until the next token refresh.
        }
      }
      await refreshAccount();
    } catch (requestError) {
      throw new Error(errorMessage(requestError));
    }
  }, [applyAccountData, refreshAccount, refreshSession]);

  const cancelOAuth = useCallback(async (state: string) => {
    setError('');
    try {
      if (state.startsWith('calendar.')) await googleCalendarApi.oauthCancel(state);
      else await accountApi.oauthCancel(state);
    } catch (requestError) {
      throw new Error(errorMessage(requestError));
    }
  }, []);

  const enableCalendarSync = useCallback(async () => {
    setError('');
    const response = await googleCalendarApi.authorize();
    const authorizationUrl = response.data.data.authorization_url;
    if (!authorizationUrl) throw new Error('The Calendar service did not return an authorization URL.');
    window.location.assign(authorizationUrl);
  }, []);

  const syncCalendarNow = useCallback(async () => {
    setError('');
    const response = await googleCalendarApi.sync();
    setCalendarSync(response.data.data.calendar_sync);
  }, []);

  const disableCalendarSync = useCallback(async () => {
    setError('');
    const response = await googleCalendarApi.disable();
    setCalendarSync(response.data.data.calendar_sync);
  }, []);

  const disconnect = useCallback(async (provider: ConnectionProvider) => {
    setError('');
    try {
      const response = await accountApi.disconnect(provider);
      applyAccountData(response.data.data);
      await refreshSession();
      await refreshAccount();
    } catch (requestError) {
      throw new Error(errorMessage(requestError));
    }
  }, [applyAccountData, refreshAccount, refreshSession]);

  const deleteAccount = useCallback(async (confirmation: string) => {
    setError('');
    try {
      await accountApi.delete(confirmation);
    } catch (requestError) {
      throw new Error(errorMessage(requestError));
    }
  }, []);

  const isConnected = useCallback((provider: ConnectionProvider) => {
    if (hasProviderIdentity(user, provider)) return true;
    const connection = connections[provider];
    return typeof connection === 'boolean' ? connection : connection?.connected === true;
  }, [connections, user]);

  const value = useMemo<AccountContextValue>(() => ({
    profile,
    connections,
    password_change_available: passwordChangeAvailable,
    native_mfa: nativeMfa,
    calendar_sync: calendarSync,
    loading,
    error,
    refreshAccount,
    updateProfile,
    completeOnboarding,
    connect,
    completeOAuth,
    cancelOAuth,
    disconnect,
    deleteAccount,
    enableCalendarSync,
    syncCalendarNow,
    disableCalendarSync,
    isConnected,
  }), [calendarSync, cancelOAuth, completeOAuth, completeOnboarding, connect, connections, deleteAccount, disableCalendarSync, disconnect, enableCalendarSync, error, isConnected, loading, nativeMfa, passwordChangeAvailable, profile, refreshAccount, syncCalendarNow, updateProfile]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccount must be used within AccountProvider');
  return context;
}
