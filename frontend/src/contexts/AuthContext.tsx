import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { cognitoAuth, decodeJWT, tokenStorage, type ChallengeResponse } from '../services/cognitoAuth';
import { AUTH_STORAGE_CHANGE_EVENT, type AuthStoragePreference } from '../services/authStorage';

export interface CognitoUser {
  sub: string;
  email: string;
  username: string;
  groups?: string[];
  [key: string]: any;
}

export interface NativeMfaChallenge {
  type: 'totp' | 'email';
  destination?: string;
}

interface PendingNativeMfaChallenge {
  cognito: ChallengeResponse;
  username: string;
  storagePreference: AuthStoragePreference;
}

interface AuthContextType {
  user: CognitoUser | null;
  loading: boolean;
  nativeMfaChallenge: NativeMfaChallenge | null;
  signIn: (username: string, password: string, storagePreference?: AuthStoragePreference) => Promise<NativeMfaChallenge | null>;
  completeMfaSignIn: (code: string) => Promise<void>;
  cancelMfaSignIn: () => void;
  signUp: (username: string, password: string, email: string) => Promise<void>;
  confirmSignUp: (username: string, code: string) => Promise<void>;
  resendConfirmationCode: (username: string) => Promise<void>;
  signOut: () => Promise<void>;
  forgotPassword: (username: string) => Promise<void>;
  confirmForgotPassword: (username: string, code: string, newPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateUserAttributes: (attributes: Array<{ Name: string; Value: string }>) => Promise<void>;
  refreshSession: () => Promise<void>;
  loadSessionFromStorage: () => void;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<CognitoUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingNativeMfa, setPendingNativeMfa] = useState<PendingNativeMfaChallenge | null>(null);
  const nativeMfaChallenge: NativeMfaChallenge | null = pendingNativeMfa ? {
    type: pendingNativeMfa.cognito.ChallengeName === 'SOFTWARE_TOKEN_MFA' ? 'totp' : 'email',
    ...(pendingNativeMfa.cognito.ChallengeParameters.CODE_DELIVERY_DESTINATION
      ? { destination: pendingNativeMfa.cognito.ChallengeParameters.CODE_DELIVERY_DESTINATION }
      : {}),
  } : null;

  // Extract user from token
  const extractUserFromToken = (idToken: string): CognitoUser | null => {
    const decoded = decodeJWT(idToken);
    if (!decoded) return null;

    const cognitoUsername = decoded['cognito:username'] || decoded.username || decoded.email;
    const isGoogleUser = typeof cognitoUsername === 'string' && cognitoUsername.toLowerCase().startsWith('google_');
    const fallbackDisplayName = decoded.name || decoded.email?.split('@')[0];
    const displayUsername = decoded.preferred_username
      || (isGoogleUser ? fallbackDisplayName : cognitoUsername)
      || fallbackDisplayName
      || 'User';

    return {
      ...decoded,
      sub: decoded.sub,
      email: decoded.email,
      username: displayUsername,
      groups: decoded['cognito:groups'] || [],
    };
  };

  // Check for existing session
  useEffect(() => {
    const checkSession = async () => {
      try {
        const idToken = tokenStorage.getIdToken();
        if (!idToken) {
          setLoading(false);
          return;
        }

        // Check if token is expired
        if (tokenStorage.isTokenExpired()) {
          try {
            await cognitoAuth.refreshTokens();
            const newIdToken = tokenStorage.getIdToken();
            if (newIdToken) {
              setUser(extractUserFromToken(newIdToken));
            }
          } catch (e) {
            // Refresh failed, clear tokens
            tokenStorage.clearTokens();
            setUser(null);
          }
        } else {
          setUser(extractUserFromToken(idToken));
        }
      } catch (error) {
        console.error('Session check failed:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  useEffect(() => {
    const synchronizeUser = () => {
      const idToken = tokenStorage.getIdToken();
      setUser(idToken ? extractUserFromToken(idToken) : null);
    };

    window.addEventListener(AUTH_STORAGE_CHANGE_EVENT, synchronizeUser);
    return () => window.removeEventListener(AUTH_STORAGE_CHANGE_EVENT, synchronizeUser);
  }, []);

  const signIn = async (
    username: string,
    password: string,
    storagePreference: AuthStoragePreference = 'session',
  ): Promise<NativeMfaChallenge | null> => {
    setPendingNativeMfa(null);
    const result = await cognitoAuth.signIn(username, password, storagePreference);

    if ('ChallengeName' in result) {
      if (!['SOFTWARE_TOKEN_MFA', 'EMAIL_OTP'].includes(result.ChallengeName)) {
        throw new Error(`Unsupported Cognito challenge: ${result.ChallengeName}`);
      }
      setPendingNativeMfa({ cognito: result, username, storagePreference });
      return {
        type: result.ChallengeName === 'SOFTWARE_TOKEN_MFA' ? 'totp' : 'email',
        ...(result.ChallengeParameters.CODE_DELIVERY_DESTINATION
          ? { destination: result.ChallengeParameters.CODE_DELIVERY_DESTINATION }
          : {}),
      };
    }

    const idToken = tokenStorage.getIdToken();
    if (idToken) setUser(extractUserFromToken(idToken));
    return null;
  };

  const completeMfaSignIn = async (code: string): Promise<void> => {
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit verification code.');
    if (!pendingNativeMfa) throw new Error('This MFA challenge has expired. Sign in again.');
    const result = await cognitoAuth.respondToMfaChallenge(
      pendingNativeMfa.cognito,
      pendingNativeMfa.username,
      code,
      pendingNativeMfa.storagePreference,
    );
    if ('ChallengeName' in result) {
      if (!['SOFTWARE_TOKEN_MFA', 'EMAIL_OTP'].includes(result.ChallengeName)) {
        setPendingNativeMfa(null);
        throw new Error(`Unsupported Cognito challenge: ${result.ChallengeName}`);
      }
      setPendingNativeMfa((current) => current ? { ...current, cognito: result } : null);
      throw new Error('Another verification code is required.');
    }
    setPendingNativeMfa(null);
    const idToken = tokenStorage.getIdToken();
    if (idToken) setUser(extractUserFromToken(idToken));
  };

  const cancelMfaSignIn = () => setPendingNativeMfa(null);

  const signUp = async (username: string, password: string, email: string) => {
    await cognitoAuth.signUp(username, password, email);
  };

  const confirmSignUp = async (username: string, code: string) => {
    await cognitoAuth.confirmSignUp(username, code);
  };

  const resendConfirmationCode = async (username: string) => {
    await cognitoAuth.resendConfirmationCode(username);
  };

  const signOut = async () => {
    setPendingNativeMfa(null);
    await cognitoAuth.signOut();
    setUser(null);
  };

  const forgotPassword = async (username: string) => {
    await cognitoAuth.forgotPassword(username);
  };

  const confirmForgotPassword = async (username: string, code: string, newPassword: string) => {
    await cognitoAuth.confirmForgotPassword(username, code, newPassword);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await cognitoAuth.changePassword(currentPassword, newPassword);
  };

  const updateUserAttributes = async (attributes: Array<{ Name: string; Value: string }>) => {
    await cognitoAuth.updateUserAttributes(attributes);
  };

  const refreshSession = async () => {
    await cognitoAuth.refreshTokens();
    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      setUser(extractUserFromToken(idToken));
    }
  };

  const loadSessionFromStorage = () => {
    const idToken = tokenStorage.getIdToken();
    if (idToken) {
      setUser(extractUserFromToken(idToken));
    }
  };

  const isAdmin = (): boolean => {
    return user?.['cognito:username'] === 'admin' && user?.groups?.includes('Admins') === true;
  };

  const value: AuthContextType = {
    user,
    loading,
    nativeMfaChallenge,
    signIn,
    completeMfaSignIn,
    cancelMfaSignIn,
    signUp,
    confirmSignUp,
    resendConfirmationCode,
    signOut,
    forgotPassword,
    confirmForgotPassword,
    changePassword,
    updateUserAttributes,
    refreshSession,
    loadSessionFromStorage,
    isAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthContext;
