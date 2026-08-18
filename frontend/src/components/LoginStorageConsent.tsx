import { useEffect, useState } from 'react';
import { Clock3, Cookie, MonitorCheck, ShieldCheck } from 'lucide-react';
import {
  AUTH_STORAGE_CHANGE_EVENT,
  tokenStorage,
  type AuthStoragePreference,
} from '../services/authStorage';

function useStoragePreference() {
  const [preference, setPreference] = useState<AuthStoragePreference | null>(() => tokenStorage.getPreference());

  useEffect(() => {
    const synchronize = () => setPreference(tokenStorage.getPreference());
    window.addEventListener(AUTH_STORAGE_CHANGE_EVENT, synchronize);
    return () => window.removeEventListener(AUTH_STORAGE_CHANGE_EVENT, synchronize);
  }, []);

  return [preference, setPreference] as const;
}

export function LoginStoragePrompt() {
  const [preference, setPreference] = useStoragePreference();
  const [error, setError] = useState('');

  if (preference) return null;

  const choose = (requested: AuthStoragePreference) => {
    setError('');
    const applied = tokenStorage.setPreference(requested);
    if (requested === 'persistent' && applied !== 'persistent') {
      setPreference(null);
      setError('This browser blocked persistent storage. Your login will remain session-only.');
      return;
    }
    setPreference(applied);
  };

  return (
    <aside className="login-storage-prompt" role="dialog" aria-labelledby="login-storage-title" aria-describedby="login-storage-description">
      <div className="login-storage-icon" aria-hidden="true"><Cookie size={24} /></div>
      <div className="min-w-0 flex-1">
        <h2 id="login-storage-title" className="font-semibold">Keep your login on this browser?</h2>
        <p id="login-storage-description" className="mt-1 text-sm text-gray-600">
          Allow browser storage to keep your Cognito session after you close the app. Choose session-only on a shared device. We do not use advertising or tracking cookies.
        </p>
        {error && <p className="mt-2 text-sm font-medium text-amber-700" role="alert">{error}</p>}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn-primary" onClick={() => choose('persistent')}>Remember this browser</button>
          <button type="button" className="btn-secondary" onClick={() => choose('session')}>Use session only</button>
        </div>
      </div>
    </aside>
  );
}

export function LoginStorageSettings() {
  const [preference, setPreference] = useStoragePreference();
  const [message, setMessage] = useState('');

  const choose = (requested: AuthStoragePreference) => {
    const applied = tokenStorage.setPreference(requested);
    setPreference(applied);
    setMessage(
      requested === 'persistent' && applied !== 'persistent'
        ? 'Persistent storage is unavailable in this browser. Your login remains session-only.'
        : applied === 'persistent'
          ? 'This login will be available after you close and reopen this browser.'
          : 'This login will be removed when the browser session ends.',
    );
  };

  return (
    <section className="card" aria-labelledby="login-storage-settings-heading">
      <div className="mb-5 flex gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <ShieldCheck size={22} />
        </div>
        <div>
          <h2 id="login-storage-settings-heading" className="text-lg font-semibold">Browser login</h2>
          <p className="text-sm text-gray-500">Control whether this Cognito login survives closing the browser.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={`storage-preference-option ${preference === 'persistent' ? 'storage-preference-option-active' : ''}`}
          aria-pressed={preference === 'persistent'}
          onClick={() => choose('persistent')}
        >
          <MonitorCheck size={21} />
          <span><strong>Remember this browser</strong><small>Best for a personal, protected device.</small></span>
        </button>
        <button
          type="button"
          className={`storage-preference-option ${preference !== 'persistent' ? 'storage-preference-option-active' : ''}`}
          aria-pressed={preference !== 'persistent'}
          onClick={() => choose('session')}
        >
          <Clock3 size={21} />
          <span><strong>Session only</strong><small>Best for a shared or public device.</small></span>
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">Only authentication tokens move between session and persistent browser storage. OAuth state and PKCE verification data remain session-only.</p>
      {message && <p className="mt-3 text-sm font-medium text-green-700" role="status">{message}</p>}
    </section>
  );
}

export default LoginStoragePrompt;
