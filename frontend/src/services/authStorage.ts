export type AuthStoragePreference = 'persistent' | 'session';

export interface AuthTokens {
  IdToken: string;
  AccessToken: string;
  RefreshToken: string;
  ExpiresIn: number;
}

interface StoredTokenBundle {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AuthStorageChange {
  kind: 'logout' | 'preference' | 'tokens';
  preference: AuthStoragePreference | null;
}

export const AUTH_STORAGE_CHANGE_EVENT = 'nyp-auth-storage-change';
export const AUTH_STORAGE_PREFERENCE_KEY = 'nyp.auth.persistence.v1';
export const AUTH_TOKEN_BUNDLE_KEY = 'nyp.auth.tokens.v1';

const LEGACY_TOKEN_KEYS = ['idToken', 'accessToken', 'refreshToken', 'tokenExpiry'] as const;

type ChangeListener = (change: AuthStorageChange) => void;

function isPreference(value: string | null): value is AuthStoragePreference {
  return value === 'persistent' || value === 'session';
}

function parseBundle(value: string | null): StoredTokenBundle | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoredTokenBundle>;
    if (
      typeof parsed.idToken !== 'string' || !parsed.idToken
      || typeof parsed.accessToken !== 'string' || !parsed.accessToken
      || typeof parsed.refreshToken !== 'string' || !parsed.refreshToken
      || typeof parsed.tokenExpiry !== 'number' || !Number.isFinite(parsed.tokenExpiry) || parsed.tokenExpiry <= 0
    ) {
      return null;
    }

    return parsed as StoredTokenBundle;
  } catch {
    return null;
  }
}

function legacyBundle(storage: StorageLike): StoredTokenBundle | null {
  const idToken = storage.getItem('idToken');
  const accessToken = storage.getItem('accessToken');
  const refreshToken = storage.getItem('refreshToken');
  const expiry = Number(storage.getItem('tokenExpiry'));

  if (!idToken || !accessToken || !refreshToken || !Number.isFinite(expiry) || expiry <= 0) {
    return null;
  }

  return { idToken, accessToken, refreshToken, tokenExpiry: expiry };
}

function removeAuthData(storage: StorageLike) {
  storage.removeItem(AUTH_TOKEN_BUNDLE_KEY);
  for (const key of LEGACY_TOKEN_KEYS) storage.removeItem(key);
}

export function createAuthTokenStorage(
  persistentStorage: StorageLike,
  sessionStorage: StorageLike,
  onChange: ChangeListener = () => undefined,
) {
  let generation = 0;

  const safePreference = (): AuthStoragePreference | null => {
    try {
      const value = persistentStorage.getItem(AUTH_STORAGE_PREFERENCE_KEY);
      if (isPreference(value)) return value;
      if (value !== null) persistentStorage.removeItem(AUTH_STORAGE_PREFERENCE_KEY);
    } catch {
      // Storage can be disabled by browser privacy settings. Session-only remains the default.
    }
    return null;
  };

  const selectedStorage = (preference = safePreference()) => (
    preference === 'persistent' ? persistentStorage : sessionStorage
  );

  const readBundle = (storage: StorageLike): StoredTokenBundle | null => {
    const raw = storage.getItem(AUTH_TOKEN_BUNDLE_KEY);
    const bundle = parseBundle(raw);
    if (raw && !bundle) storage.removeItem(AUTH_TOKEN_BUNDLE_KEY);
    return bundle;
  };

  const writeVerifiedBundle = (storage: StorageLike, bundle: StoredTokenBundle) => {
    const serialized = JSON.stringify(bundle);
    storage.setItem(AUTH_TOKEN_BUNDLE_KEY, serialized);
    const stored = readBundle(storage);
    if (!stored || JSON.stringify(stored) !== serialized) {
      throw new Error('Browser storage did not retain the complete authentication session');
    }
  };

  const reconcile = (notify = false) => {
    const preference = safePreference();

    try {
      if (!preference) {
        const existing = readBundle(sessionStorage) || legacyBundle(sessionStorage);
        if (existing) writeVerifiedBundle(sessionStorage, existing);
        removeAuthData(persistentStorage);
        for (const key of LEGACY_TOKEN_KEYS) sessionStorage.removeItem(key);
      } else {
        const selected = selectedStorage(preference);
        const other = preference === 'persistent' ? sessionStorage : persistentStorage;
        const existing = readBundle(selected) || legacyBundle(selected);
        if (existing) writeVerifiedBundle(selected, existing);
        removeAuthData(other);
        for (const key of LEGACY_TOKEN_KEYS) selected.removeItem(key);
      }
    } catch {
      // Corrupt or unavailable storage must never cause a persistent-session fallback without consent.
      try { removeAuthData(persistentStorage); } catch { /* best effort */ }
    }

    if (notify) onChange({ kind: 'tokens', preference });
  };

  const getBundle = (): StoredTokenBundle | null => {
    try {
      return readBundle(selectedStorage());
    } catch {
      return null;
    }
  };

  const setPreference = (requested: AuthStoragePreference): AuthStoragePreference => {
    const currentBundle = getBundle();

    if (requested === 'persistent') {
      try {
        if (currentBundle) writeVerifiedBundle(persistentStorage, currentBundle);
        persistentStorage.setItem(AUTH_STORAGE_PREFERENCE_KEY, 'persistent');
        removeAuthData(sessionStorage);
        onChange({ kind: 'preference', preference: 'persistent' });
        return 'persistent';
      } catch {
        // If persistent storage is blocked or full, retain the session rather than losing authentication.
        try { removeAuthData(persistentStorage); } catch { /* best effort */ }
        if (currentBundle) {
          try { writeVerifiedBundle(sessionStorage, currentBundle); } catch { /* signed out below */ }
        }
        try { persistentStorage.setItem(AUTH_STORAGE_PREFERENCE_KEY, 'session'); } catch { /* default is session */ }
        onChange({ kind: 'preference', preference: 'session' });
        return 'session';
      }
    }

    // Stopping persistence takes priority. If the session copy fails, local credentials are still removed.
    let retainedSession = true;
    if (currentBundle) {
      try {
        writeVerifiedBundle(sessionStorage, currentBundle);
      } catch {
        retainedSession = false;
        try { removeAuthData(sessionStorage); } catch { /* best effort */ }
      }
    }
    try { persistentStorage.setItem(AUTH_STORAGE_PREFERENCE_KEY, 'session'); } catch { /* default is session */ }
    try { removeAuthData(persistentStorage); } catch { /* best effort */ }
    if (!retainedSession) generation += 1;
    onChange({ kind: 'preference', preference: 'session' });
    return 'session';
  };

  const setTokens = (
    tokens: AuthTokens,
    preference?: AuthStoragePreference,
    expectedGeneration?: number,
  ): AuthStoragePreference | null => {
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return null;
    if (preference) setPreference(preference);

    const bundle: StoredTokenBundle = {
      idToken: tokens.IdToken,
      accessToken: tokens.AccessToken,
      refreshToken: tokens.RefreshToken,
      tokenExpiry: Date.now() + tokens.ExpiresIn * 1000,
    };
    const selectedPreference = safePreference() || 'session';

    try {
      writeVerifiedBundle(selectedStorage(selectedPreference), bundle);
      removeAuthData(selectedPreference === 'persistent' ? sessionStorage : persistentStorage);
      onChange({ kind: 'tokens', preference: safePreference() });
      return selectedPreference;
    } catch {
      if (selectedPreference === 'persistent') {
        const fallback = setPreference('session');
        try {
          writeVerifiedBundle(sessionStorage, bundle);
          onChange({ kind: 'tokens', preference: fallback });
          return fallback;
        } catch {
          // Continue to the fail-closed cleanup below.
        }
      }
      generation += 1;
      try { removeAuthData(sessionStorage); } catch { /* best effort */ }
      try { removeAuthData(persistentStorage); } catch { /* best effort */ }
      onChange({ kind: 'logout', preference: safePreference() });
      return null;
    }
  };

  const clearTokens = () => {
    generation += 1;
    try { removeAuthData(sessionStorage); } catch { /* best effort */ }
    try { removeAuthData(persistentStorage); } catch { /* best effort */ }
    onChange({ kind: 'logout', preference: safePreference() });
  };

  const clearSessionForRemoteChange = () => {
    generation += 1;
    try { removeAuthData(sessionStorage); } catch { /* best effort */ }
    onChange({ kind: 'tokens', preference: safePreference() });
  };

  reconcile();

  return {
    getPreference: safePreference,
    setPreference,
    reconcile,
    setTokens,
    clearTokens,
    clearSessionForRemoteChange,
    getGeneration: () => generation,
    getIdToken: () => getBundle()?.idToken ?? null,
    getAccessToken: () => getBundle()?.accessToken ?? null,
    getRefreshToken: () => getBundle()?.refreshToken ?? null,
    getTokenExpiry: () => getBundle()?.tokenExpiry ?? null,
    isTokenExpired() {
      const expiry = this.getTokenExpiry();
      return !expiry || Date.now() >= expiry - 60000;
    },
  };
}

let broadcastChannel: BroadcastChannel | null = null;
let applyingRemoteChange = false;
let browserTokenStorage: ReturnType<typeof createAuthTokenStorage>;

const emitBrowserChange: ChangeListener = (change) => {
  window.dispatchEvent(new CustomEvent<AuthStorageChange>(AUTH_STORAGE_CHANGE_EVENT, { detail: change }));
  if (
    !applyingRemoteChange
    && (change.kind === 'logout' || change.kind === 'preference' || (change.kind === 'tokens' && change.preference === 'persistent'))
  ) {
    broadcastChannel?.postMessage(change);
  }
};

browserTokenStorage = createAuthTokenStorage(window.localStorage, window.sessionStorage, emitBrowserChange);

if ('BroadcastChannel' in window) {
  broadcastChannel = new BroadcastChannel('nyp.auth.v1');
  broadcastChannel.addEventListener('message', (event: MessageEvent<AuthStorageChange>) => {
    const change = event.data;
    if (!change || (change.kind !== 'logout' && change.kind !== 'preference' && change.kind !== 'tokens')) return;
    if (change.kind === 'tokens' && change.preference !== 'persistent') return;

    applyingRemoteChange = true;
    try {
      if (change.kind === 'logout' || change.preference === 'session') {
        browserTokenStorage.clearSessionForRemoteChange();
      } else {
        browserTokenStorage.reconcile(true);
      }
    } finally {
      applyingRemoteChange = false;
    }
  });
}

export const tokenStorage = browserTokenStorage;
