import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

class MemoryStorage {
  #values = new Map();
  failWrites = false;

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('storage write blocked');
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

const bootstrapLocal = new MemoryStorage();
const bootstrapSession = new MemoryStorage();
globalThis.window = {
  localStorage: bootstrapLocal,
  sessionStorage: bootstrapSession,
  dispatchEvent: () => true,
};

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass the compiled authStorage module path');

const {
  AUTH_STORAGE_PREFERENCE_KEY,
  AUTH_TOKEN_BUNDLE_KEY,
  createAuthTokenStorage,
} = await import(pathToFileURL(path.resolve(modulePath)).href);

const tokens = {
  IdToken: 'header.id.signature',
  AccessToken: 'header.access.signature',
  RefreshToken: 'refresh-token',
  ExpiresIn: 3600,
};

function stores() {
  return { local: new MemoryStorage(), session: new MemoryStorage() };
}

{
  const { local, session } = stores();
  const storage = createAuthTokenStorage(local, session);
  assert.equal(storage.getPreference(), null, 'first visit has no consent preference');
  assert.equal(storage.setTokens(tokens), 'session');
  assert.ok(session.getItem(AUTH_TOKEN_BUNDLE_KEY), 'default token bundle is session-only');
  assert.equal(local.getItem(AUTH_TOKEN_BUNDLE_KEY), null);
}

{
  const { local, session } = stores();
  const storage = createAuthTokenStorage(local, session);
  storage.setTokens(tokens);
  assert.equal(storage.setPreference('persistent'), 'persistent');
  assert.ok(local.getItem(AUTH_TOKEN_BUNDLE_KEY), 'accepting persistence migrates the complete bundle');
  assert.equal(session.getItem(AUTH_TOKEN_BUNDLE_KEY), null, 'migration removes the session duplicate');
  assert.equal(local.getItem(AUTH_STORAGE_PREFERENCE_KEY), 'persistent');

  assert.equal(storage.setPreference('session'), 'session');
  assert.ok(session.getItem(AUTH_TOKEN_BUNDLE_KEY), 'downgrade migrates the active bundle to session storage');
  assert.equal(local.getItem(AUTH_TOKEN_BUNDLE_KEY), null, 'downgrade removes persistent credentials');
}

{
  const { local, session } = stores();
  session.setItem('idToken', tokens.IdToken);
  session.setItem('accessToken', tokens.AccessToken);
  session.setItem('refreshToken', tokens.RefreshToken);
  session.setItem('tokenExpiry', String(Date.now() + 3600000));
  const storage = createAuthTokenStorage(local, session);
  assert.equal(storage.getIdToken(), tokens.IdToken, 'legacy session keys migrate on startup');
  assert.ok(session.getItem(AUTH_TOKEN_BUNDLE_KEY));
  assert.equal(session.getItem('idToken'), null, 'legacy token keys are removed after migration');
}

{
  const { local, session } = stores();
  local.setItem(AUTH_TOKEN_BUNDLE_KEY, JSON.stringify({ idToken: 'stale' }));
  const storage = createAuthTokenStorage(local, session);
  assert.equal(storage.getIdToken(), null, 'persistent data is not resurrected without consent');
  assert.equal(local.getItem(AUTH_TOKEN_BUNDLE_KEY), null, 'stale or corrupt persistent data is cleared');
}

{
  const { local, session } = stores();
  const storage = createAuthTokenStorage(local, session);
  storage.setTokens(tokens);
  local.failWrites = true;
  assert.equal(storage.setPreference('persistent'), 'session', 'blocked persistent storage falls back safely');
  assert.equal(storage.getIdToken(), tokens.IdToken, 'fallback retains the valid session');
  assert.ok(session.getItem(AUTH_TOKEN_BUNDLE_KEY));
}

{
  const { local, session } = stores();
  const storage = createAuthTokenStorage(local, session);
  storage.setPreference('persistent');
  storage.setTokens(tokens);
  session.setItem('idToken', 'legacy-copy');
  storage.clearTokens();
  assert.equal(local.getItem(AUTH_TOKEN_BUNDLE_KEY), null, 'sign-out clears persistent credentials');
  assert.equal(session.getItem(AUTH_TOKEN_BUNDLE_KEY), null, 'sign-out clears session credentials');
  assert.equal(session.getItem('idToken'), null, 'sign-out also clears legacy credentials');
}

console.log('authStorage behavioral checks passed (6 scenarios)');
