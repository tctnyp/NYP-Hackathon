import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { CalendarClock, Link2, LoaderCircle, LogOut, MessageCircle, Monitor, Moon, RefreshCw, Save, Sun, Upload, UserRound, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConnectionProvider, useAccount } from '../contexts/AccountContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemePreference, useTheme } from '../contexts/ThemeContext';
import BackgroundPicker from './BackgroundPicker';
import { LoginStorageSettings } from './LoginStorageConsent';
import NotificationSettings from './NotificationSettings';

const PROFILE_PICTURE_MAX_LENGTH = 200_000;
const PROFILE_PICTURE_PATTERN = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i;

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const providers: Array<{
  id: ConnectionProvider;
  name: string;
  description: string;
  icon: typeof Link2;
}> = [
  { id: 'google', name: 'Google', description: 'Connect your Google identity to this account.', icon: Link2 },
  { id: 'discord', name: 'Discord', description: 'Connect Discord without storing provider tokens in this app.', icon: MessageCircle },
];

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function AccountSettings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, changePassword, signOut } = useAuth();
  const {
    profile,
    connections,
    password_change_available: passwordChangeAvailable,
    loading,
    error: accountError,
    updateProfile,
    connect,
    completeOAuth,
    disconnect,
    calendar_sync: calendarSync,
    enableCalendarSync,
    syncCalendarNow,
    disableCalendarSync,
    refreshAccount,
    isConnected,
  } = useAccount();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState<ConnectionProvider | 'callback' | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [calendarBusy, setCalendarBusy] = useState<'enable' | 'sync' | 'disable' | null>(null);
  const [calendarError, setCalendarError] = useState('');
  const [calendarMessage, setCalendarMessage] = useState('');
  const callbackStarted = useRef(false);

  useEffect(() => {
    setDisplayName(profile.display_name || user?.preferred_username || user?.username || '');
    setFullName(profile.full_name || user?.name || '');
    setProfilePicture(profile.profile_picture || null);
  }, [profile, user]);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error_description') || searchParams.get('error');

    if (oauthError && !callbackStarted.current) {
      callbackStarted.current = true;
      setConnectionError(oauthError);
      navigate('/account/settings', { replace: true });
      return;
    }
    if (!code && !state) return;
    if (!code || !state) {
      setConnectionError('The account connection callback was incomplete. Please try connecting again.');
      navigate('/account/settings', { replace: true });
      return;
    }
    if (callbackStarted.current) return;

    callbackStarted.current = true;
    setConnectionBusy('callback');
    setConnectionError('');
    void completeOAuth(code, state)
      .then(() => {
        if (state.startsWith('calendar.')) setCalendarMessage('Google Calendar authorization completed.');
        else setConnectionMessage('Account connected successfully.');
      })
      .catch((callbackError) => {
        if (state.startsWith('calendar.')) setCalendarError(messageFrom(callbackError));
        else setConnectionError(messageFrom(callbackError));
      })
      .finally(() => {
        setConnectionBusy(null);
        navigate('/account/settings', { replace: true });
      });
  }, [completeOAuth, navigate, searchParams]);

  const chooseProfilePicture = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setProfileError('');
    setProfileMessage('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setProfileError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 150_000) {
      setProfileError('Choose an image smaller than 150 KB so the encoded profile picture remains under 200 KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !PROFILE_PICTURE_PATTERN.test(reader.result) || reader.result.length > PROFILE_PICTURE_MAX_LENGTH) {
        setProfileError('That image could not be used. Choose a smaller PNG, JPEG, or WebP image.');
        return;
      }
      setProfilePicture(reader.result);
    };
    reader.onerror = () => setProfileError('Unable to read that image.');
    reader.readAsDataURL(file);
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');
    const cleanDisplayName = displayName.trim();
    const cleanFullName = fullName.trim();
    if (!cleanDisplayName) {
      setProfileError('Display username is required.');
      return;
    }
    if (!cleanFullName) {
      setProfileError('Full name is required.');
      return;
    }
    if (profilePicture && (!PROFILE_PICTURE_PATTERN.test(profilePicture) || profilePicture.length > PROFILE_PICTURE_MAX_LENGTH)) {
      setProfileError('The profile picture must be a PNG, JPEG, or WebP data image under 200 KB.');
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile({ display_name: cleanDisplayName, full_name: cleanFullName, profile_picture: profilePicture });
      setProfileMessage('Profile saved.');
    } catch (saveError) {
      setProfileError(messageFrom(saveError));
    } finally {
      setSavingProfile(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (!currentPassword || !newPassword) {
      setPasswordError('Enter your current and new passwords.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('The new password must be at least 8 characters.');
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password changed successfully.');
    } catch (changeError) {
      setPasswordError(messageFrom(changeError));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleConnection = async (provider: ConnectionProvider, shouldDisconnect: boolean) => {
    setConnectionBusy(provider);
    setConnectionError('');
    setConnectionMessage('');
    try {
      if (shouldDisconnect) {
        await disconnect(provider);
        setConnectionMessage(`${provider === 'google' ? 'Google' : 'Discord'} disconnected.`);
      } else {
        await connect(provider);
      }
    } catch (requestError) {
      setConnectionError(messageFrom(requestError));
      setConnectionBusy(null);
    } finally {
      if (shouldDisconnect) setConnectionBusy(null);
    }
  };

  const handleCalendarAction = async (action: 'enable' | 'sync' | 'disable') => {
    setCalendarBusy(action);
    setCalendarError('');
    setCalendarMessage('');
    try {
      if (action === 'enable') {
        await enableCalendarSync();
      } else if (action === 'sync') {
        await syncCalendarNow();
        setCalendarMessage('Google Calendar synchronization requested. Updates will be processed shortly.');
      } else {
        await disableCalendarSync();
        setCalendarMessage('Calendar cleanup started. Managed events and credentials will be removed before Google can be unlinked.');
      }
    } catch (requestError) {
      setCalendarError(messageFrom(requestError));
      try {
        await refreshAccount();
      } catch {
        // Preserve the original Calendar action error when status refresh also fails.
      }
      setCalendarBusy(null);
    } finally {
      if (action !== 'enable') setCalendarBusy(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (signOutError) {
      setProfileError(messageFrom(signOutError));
    }
  };

  const avatarText = (displayName || user?.username || 'U').charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account settings</h1>
          <p className="text-gray-600">Manage your profile, security, appearance, and connected accounts.</p>
        </div>
        <button type="button" className="btn-secondary flex items-center justify-center gap-2 text-red-600" onClick={() => void handleSignOut()}>
          <LogOut size={18} /> Sign out
        </button>
      </div>

      {(accountError || loading) && (
        <div className="card py-3 text-sm" role={accountError ? 'alert' : 'status'}>
          {loading ? 'Loading account details…' : accountError}
        </div>
      )}

      <section className="card" aria-labelledby="profile-heading">
        <div className="mb-5">
          <h2 id="profile-heading" className="text-lg font-semibold">Profile</h2>
          <p className="text-sm text-gray-500">Choose how your name and picture appear in the app.</p>
        </div>
        <form className="space-y-5" onSubmit={saveProfile}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {profilePicture ? (
              <img src={profilePicture} alt="Current profile" className="h-24 w-24 rounded-full border object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary-100 text-3xl font-semibold text-primary-700" aria-label="Profile placeholder">
                {avatarText || <UserRound size={32} />}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <label className="btn-secondary flex cursor-pointer items-center gap-2">
                <Upload size={17} /> Choose picture
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseProfilePicture} />
              </label>
              {profilePicture && (
                <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => setProfilePicture(null)}>
                  <X size={17} /> Remove
                </button>
              )}
              <p className="w-full text-xs text-gray-500">PNG, JPEG, or WebP; encoded size under 200 KB.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              <span>Display username</span>
              <input className="input-field" value={displayName} maxLength={64} autoComplete="nickname" onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>Full name</span>
              <input className="input-field" value={fullName} maxLength={120} autoComplete="name" onChange={(event) => setFullName(event.target.value)} />
            </label>
          </div>
          <p className="text-sm text-gray-500">Email: {profile.email || user?.email}</p>
          {profileError && <p className="text-sm font-medium text-red-600" role="alert">{profileError}</p>}
          {profileMessage && <p className="text-sm font-medium text-green-700" role="status">{profileMessage}</p>}
          <button className="btn-primary flex items-center justify-center gap-2" type="submit" disabled={savingProfile}>
            {savingProfile ? <LoaderCircle className="animate-spin" size={18} /> : <Save size={18} />}
            Save profile
          </button>
        </form>
      </section>

      <LoginStorageSettings />

      <NotificationSettings />

      <section className="card" aria-labelledby="connections-heading">
        <div className="mb-5">
          <h2 id="connections-heading" className="text-lg font-semibold">Connected accounts</h2>
          <p className="text-sm text-gray-500">Identity-linking tokens are exchanged server-side and are not retained. Calendar permission is managed separately below.</p>
        </div>
        <div className="divide-y divide-gray-200">
          {providers.map((provider) => {
            const connected = isConnected(provider.id);
            const connection = connections[provider.id];
            const details = typeof connection === 'object' ? connection : undefined;
            const disconnectAllowed = details?.disconnect_allowed !== false;
            const busy = connectionBusy === provider.id || connectionBusy === 'callback';
            const actionDisabled = busy || (connected && !disconnectAllowed);
            const actionLabel = busy ? 'Working…' : connected ? 'Unlink' : 'Link';
            const Icon = provider.icon;
            return (
              <div key={provider.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100"><Icon size={22} /></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{provider.name}</h3>
                      <span className={connected ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700' : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600'}>
                        {connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{provider.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={connected ? 'btn-secondary text-red-600' : 'btn-primary'}
                  disabled={actionDisabled}
                  onClick={() => void handleConnection(provider.id, connected)}
                >
                  {actionLabel}
                </button>
              </div>
            );
          })}
        </div>
        {connectionError && <p className="mt-4 text-sm font-medium text-red-600" role="alert">{connectionError}</p>}
        {connectionMessage && <p className="mt-4 text-sm font-medium text-green-700" role="status">{connectionMessage}</p>}
      </section>

      <section className="card" aria-labelledby="calendar-sync-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
              <CalendarClock size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="calendar-sync-heading" className="text-lg font-semibold">Google Calendar auto-sync</h2>
                <span className={calendarSync.enabled
                  ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700'
                  : calendarSync.status === 'cleanup_reauthorization_required'
                    ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700'
                    : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600'}>
                  {calendarSync.enabled
                    ? 'On'
                    : calendarSync.status === 'cleanup_reauthorization_required'
                      ? 'Cleanup needs authorization'
                      : calendarSync.status === 'disable_pending'
                        ? 'Cleanup pending'
                        : 'Off'}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                With your explicit consent, task deadlines are created, updated, and removed automatically. Calendar permission is separate from Google sign-in.
              </p>
              {calendarSync.calendar_email && <p className="mt-2 text-sm text-gray-600">Calendar: {calendarSync.calendar_email}</p>}
              {calendarSync.last_sync_at && <p className="mt-1 text-xs text-gray-500">Last synced {new Date(calendarSync.last_sync_at).toLocaleString()}</p>}
              {calendarSync.last_error && <p className="mt-1 text-xs font-medium text-amber-700">Attention required: {calendarSync.last_error.replace(/_/g, ' ')}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {!calendarSync.enabled ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!calendarSync.linked || !calendarSync.available || calendarBusy !== null || calendarSync.status === 'disable_pending'}
                onClick={() => void handleCalendarAction('enable')}
              >
                {calendarBusy === 'enable'
                  ? 'Opening Google…'
                  : !calendarSync.linked
                    ? 'Link Google first'
                    : !calendarSync.available
                      ? 'Setup required'
                      : calendarSync.status === 'cleanup_reauthorization_required'
                        ? 'Reauthorize cleanup'
                        : 'Enable auto-sync'}
              </button>
            ) : (
              <>
                <button type="button" className="btn-secondary flex items-center gap-2" disabled={calendarBusy !== null} onClick={() => void handleCalendarAction('sync')}>
                  <RefreshCw className={calendarBusy === 'sync' ? 'animate-spin' : ''} size={17} /> Sync now
                </button>
                <button type="button" className="btn-secondary text-red-600" disabled={calendarBusy !== null} onClick={() => void handleCalendarAction('disable')}>
                  {calendarBusy === 'disable' ? 'Removing…' : 'Disable'}
                </button>
              </>
            )}
          </div>
        </div>
        {!calendarSync.linked && <p className="mt-4 text-sm text-gray-500">Connect Google above before requesting Calendar permission.</p>}
        <p className="mt-3 text-xs text-gray-500">Refresh credentials are encrypted server-side and are never returned to this browser. Only events managed by this app are modified.</p>
        {calendarError && <p className="mt-3 text-sm font-medium text-red-600" role="alert">{calendarError}</p>}
        {calendarMessage && <p className="mt-3 text-sm font-medium text-green-700" role="status">{calendarMessage}</p>}
      </section>

      {passwordChangeAvailable && (
        <section className="card" aria-labelledby="password-heading">
          <div className="mb-5">
            <h2 id="password-heading" className="text-lg font-semibold">Change password</h2>
            <p className="text-sm text-gray-500">Change the password for your local Cognito account.</p>
          </div>
          <form className="max-w-xl space-y-4" onSubmit={submitPassword}>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Current password</span>
              <input className="input-field" type="password" value={currentPassword} autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>New password</span>
              <input className="input-field" type="password" value={newPassword} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Confirm new password</span>
              <input className="input-field" type="password" value={confirmPassword} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            {passwordError && <p className="text-sm font-medium text-red-600" role="alert">{passwordError}</p>}
            {passwordMessage && <p className="text-sm font-medium text-green-700" role="status">{passwordMessage}</p>}
            <button className="btn-primary" type="submit" disabled={changingPassword}>
              {changingPassword ? 'Changing password…' : 'Change password'}
            </button>
          </form>
        </section>
      )}

      <section className="card" aria-labelledby="appearance-heading">
        <div className="mb-5">
          <h2 id="appearance-heading" className="text-lg font-semibold">Appearance</h2>
          <p className="text-sm text-gray-500">Theme and background preferences are saved on this device.</p>
        </div>
        <div className="mb-2 flex max-w-sm items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Color theme</p>
          <p className="text-xs font-semibold text-gray-600" role="status" aria-live="polite">
            Using {resolvedTheme === 'dark' ? 'Dark' : 'Light'} mode
          </p>
        </div>
        <div className="theme-picker mb-6 max-w-sm" role="group" aria-label="Color theme">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={theme === option.value ? 'theme-option theme-option-active' : 'theme-option'}
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                <Icon size={16} /> <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <BackgroundPicker />
      </section>
    </div>
  );
}

export default AccountSettings;
