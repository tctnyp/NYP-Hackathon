// Dependency-free Cognito authentication client using fetch API

import {
  tokenStorage,
  type AuthStoragePreference,
  type AuthTokens,
} from './authStorage';

export { tokenStorage } from './authStorage';

const COGNITO_REGION = import.meta.env.VITE_COGNITO_REGION;
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

const COGNITO_IDP_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

const OAUTH_CODE_VERIFIER_KEY = 'nyp.auth.oauth.code-verifier.v1';
const OAUTH_STATE_KEY = 'nyp.auth.oauth.state.v1';
const OAUTH_RETURN_TO_KEY = 'nyp.auth.oauth.return-to.v1';
const OAUTH_STORAGE_PREFERENCE_KEY = 'nyp.auth.oauth.persistence.v1';
const OAUTH_EXPIRES_AT_KEY = 'nyp.auth.oauth.expires-at.v1';
const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

function oauthStores(): Storage[] {
  return [window.sessionStorage, window.localStorage];
}

function readOAuthValue(key: string): string | null {
  for (const storage of oauthStores()) {
    try {
      const value = storage.getItem(key);
      if (value !== null) return value;
    } catch { /* Try the other same-origin store. */ }
  }
  return null;
}

function writeOAuthValue(key: string, value: string) {
  let stored = false;
  for (const storage of oauthStores()) {
    try { storage.setItem(key, value); stored = true; } catch { /* One working store is sufficient. */ }
  }
  if (!stored) throw new Error('This browser could not retain the sign-in transaction.');
}

function removeOAuthValue(key: string) {
  for (const storage of oauthStores()) {
    try { storage.removeItem(key); } catch { /* Best-effort one-time cleanup. */ }
  }
}

function clearOAuthTransactionStorage(includeReturnPath = true) {
  removeOAuthValue(OAUTH_CODE_VERIFIER_KEY);
  removeOAuthValue(OAUTH_STATE_KEY);
  removeOAuthValue(OAUTH_STORAGE_PREFERENCE_KEY);
  removeOAuthValue(OAUTH_EXPIRES_AT_KEY);
  if (includeReturnPath) removeOAuthValue(OAUTH_RETURN_TO_KEY);
}

type CognitoTokens = AuthTokens;

export interface ChallengeResponse {
  ChallengeName: string;
  Session: string;
  ChallengeParameters: Record<string, string>;
}

export interface NativeMfaStatus {
  enabled: Array<'totp' | 'email'>;
  preferred: 'totp' | 'email' | null;
}

// Base64url encoding for PKCE
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Generate PKCE code verifier and challenge
async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64UrlEncode(array.buffer);

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = base64UrlEncode(hash);

  return { codeVerifier, codeChallenge };
}

// Generate random state for OAuth
function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function cognitoRequest(target: string, body: any): Promise<any> {
  const response = await fetch(COGNITO_IDP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': target,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.__type || 'Cognito request failed');
  }

  return data;
}

function storeAuthenticationResult(
  result: any,
  storagePreference: AuthStoragePreference,
): CognitoTokens {
  const tokens: CognitoTokens = {
    IdToken: result.IdToken,
    AccessToken: result.AccessToken,
    RefreshToken: result.RefreshToken,
    ExpiresIn: result.ExpiresIn,
  };
  if (!tokenStorage.setTokens(tokens, storagePreference)) {
    throw new Error('This browser could not store the authentication session');
  }
  return tokens;
}

// Decode JWT payload (for UI display only, not for validation)
export function decodeJWT(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    let payload = parts[1];
    // Fix base64url padding
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) {
      payload += '=';
    }
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

// Cognito Auth API
export const cognitoAuth = {
  async signUp(username: string, password: string, email: string): Promise<{ userSub: string }> {
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.SignUp', {
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
      Password: password,
      UserAttributes: [
        {
          Name: 'email',
          Value: email,
        },
      ],
    });

    return { userSub: data.UserSub };
  },

  async confirmSignUp(username: string, code: string): Promise<void> {
    await cognitoRequest('AWSCognitoIdentityProviderService.ConfirmSignUp', {
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
    });
  },

  async resendConfirmationCode(username: string): Promise<void> {
    await cognitoRequest('AWSCognitoIdentityProviderService.ResendConfirmationCode', {
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
    });
  },

  async signIn(
    username: string,
    password: string,
    storagePreference: AuthStoragePreference = 'session',
  ): Promise<CognitoTokens | ChallengeResponse> {
    tokenStorage.setPreference(storagePreference);
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.InitiateAuth', {
      ClientId: COGNITO_CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    });

    if (data.AuthenticationResult) {
      return storeAuthenticationResult(data.AuthenticationResult, storagePreference);
    }

    // Handle challenges (e.g., NEW_PASSWORD_REQUIRED)
    return {
      ChallengeName: data.ChallengeName,
      Session: data.Session,
      ChallengeParameters: data.ChallengeParameters || {},
    };
  },

  async respondToMfaChallenge(
    challenge: ChallengeResponse,
    username: string,
    code: string,
    storagePreference: AuthStoragePreference,
  ): Promise<CognitoTokens | ChallengeResponse> {
    const responseField = challenge.ChallengeName === 'SOFTWARE_TOKEN_MFA'
      ? 'SOFTWARE_TOKEN_MFA_CODE'
      : challenge.ChallengeName === 'EMAIL_OTP'
        ? 'EMAIL_OTP_CODE'
        : null;
    if (!responseField) throw new Error('This authentication challenge is not supported.');

    const canonicalUsername = challenge.ChallengeParameters.USER_ID_FOR_SRP || username;
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.RespondToAuthChallenge', {
      ClientId: COGNITO_CLIENT_ID,
      ChallengeName: challenge.ChallengeName,
      Session: challenge.Session,
      ChallengeResponses: {
        USERNAME: canonicalUsername,
        [responseField]: code,
      },
    });

    if (data.AuthenticationResult) {
      return storeAuthenticationResult(data.AuthenticationResult, storagePreference);
    }
    return {
      ChallengeName: data.ChallengeName,
      Session: data.Session,
      ChallengeParameters: data.ChallengeParameters || {},
    };
  },

  async getMfaStatus(): Promise<NativeMfaStatus> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.GetUser', {
      AccessToken: accessToken,
    });
    const settings = Array.isArray(data.UserMFASettingList) ? data.UserMFASettingList : [];
    return {
      enabled: [
        ...(settings.includes('SOFTWARE_TOKEN_MFA') ? ['totp' as const] : []),
        ...(settings.includes('EMAIL_OTP') ? ['email' as const] : []),
      ],
      preferred: data.PreferredMfaSetting === 'SOFTWARE_TOKEN_MFA'
        ? 'totp'
        : data.PreferredMfaSetting === 'EMAIL_OTP'
          ? 'email'
          : null,
    };
  },

  async associateSoftwareToken(): Promise<string> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.AssociateSoftwareToken', {
      AccessToken: accessToken,
    });
    if (!data.SecretCode) throw new Error('Cognito did not return an authenticator secret.');
    return data.SecretCode;
  },

  async verifySoftwareToken(code: string): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.VerifySoftwareToken', {
      AccessToken: accessToken,
      UserCode: code,
      FriendlyDeviceName: 'Munera authenticator',
    });
    if (data.Status !== 'SUCCESS') throw new Error('The authenticator code could not be verified.');
  },

  async setMfaPreference(options: {
    totpEnabled?: boolean;
    emailEnabled?: boolean;
    preferred: 'totp' | 'email' | null;
  }): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    await cognitoRequest('AWSCognitoIdentityProviderService.SetUserMFAPreference', {
      AccessToken: accessToken,
      ...(typeof options.totpEnabled === 'boolean' ? {
        SoftwareTokenMfaSettings: {
          Enabled: options.totpEnabled,
          PreferredMfa: options.preferred === 'totp',
        },
      } : {}),
      ...(typeof options.emailEnabled === 'boolean' ? {
        EmailMfaSettings: {
          Enabled: options.emailEnabled,
          PreferredMfa: options.preferred === 'email',
        },
      } : {}),
    });
  },

  async refreshTokens(): Promise<CognitoTokens> {
    const writeGeneration = tokenStorage.getGeneration();
    const refreshToken = tokenStorage.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const data = await cognitoRequest('AWSCognitoIdentityProviderService.InitiateAuth', {
      ClientId: COGNITO_CLIENT_ID,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const tokens: CognitoTokens = {
      IdToken: data.AuthenticationResult.IdToken,
      AccessToken: data.AuthenticationResult.AccessToken,
      RefreshToken: refreshToken, // Refresh token is not returned on refresh
      ExpiresIn: data.AuthenticationResult.ExpiresIn,
    };

    if (!tokenStorage.setTokens(tokens, undefined, writeGeneration)) {
      throw new Error('Session changed while tokens were refreshing');
    }
    return tokens;
  },

  async signOut(): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    clearOAuthTransactionStorage();
    // Clear first so an in-flight refresh cannot restore a session after sign-out.
    tokenStorage.clearTokens();
    if (accessToken) {
      try {
        await cognitoRequest('AWSCognitoIdentityProviderService.GlobalSignOut', {
          AccessToken: accessToken,
        });
      } catch (e) {
        // Local sign-out still succeeds if Cognito is unreachable.
      }
    }
    tokenStorage.clearTokens();
  },

  async forgotPassword(username: string): Promise<void> {
    await cognitoRequest('AWSCognitoIdentityProviderService.ForgotPassword', {
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
    });
  },

  async confirmForgotPassword(username: string, code: string, newPassword: string): Promise<void> {
    await cognitoRequest('AWSCognitoIdentityProviderService.ConfirmForgotPassword', {
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    });
  },

  async changePassword(previousPassword: string, proposedPassword: string): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');

    await cognitoRequest('AWSCognitoIdentityProviderService.ChangePassword', {
      AccessToken: accessToken,
      PreviousPassword: previousPassword,
      ProposedPassword: proposedPassword,
    });
  },

  async updateUserAttributes(attributes: Array<{ Name: string; Value: string }>): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    if (!attributes.length) return;

    await cognitoRequest('AWSCognitoIdentityProviderService.UpdateUserAttributes', {
      AccessToken: accessToken,
      UserAttributes: attributes,
    });
  },

  async getUserAttributeVerificationCode(attributeName: 'email'): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    await cognitoRequest('AWSCognitoIdentityProviderService.GetUserAttributeVerificationCode', {
      AccessToken: accessToken,
      AttributeName: attributeName,
    });
  },

  async verifyUserAttribute(attributeName: 'email', code: string): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
    await cognitoRequest('AWSCognitoIdentityProviderService.VerifyUserAttribute', {
      AccessToken: accessToken,
      AttributeName: attributeName,
      Code: code,
    });
  },

  // OAuth / Hosted UI helpers. Both providers must be configured in Cognito.
  async initiateHostedUILogin(
    provider: 'Google' | 'Discord',
    returnTo = '/dashboard',
  ): Promise<void> {
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
    const appUrl = import.meta.env.VITE_APP_URL;

    if (!COGNITO_CLIENT_ID || !cognitoDomain || !appUrl) {
      throw new Error('Cognito social authentication is not configured');
    }

    clearOAuthTransactionStorage();
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = generateState();

    // Store transient values for the callback. Only local app paths are accepted.
    const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/dashboard';
    writeOAuthValue(OAUTH_CODE_VERIFIER_KEY, codeVerifier);
    writeOAuthValue(OAUTH_STATE_KEY, state);
    writeOAuthValue(OAUTH_RETURN_TO_KEY, safeReturnTo);
    writeOAuthValue(OAUTH_STORAGE_PREFERENCE_KEY, tokenStorage.getPreference() || 'session');
    writeOAuthValue(OAUTH_EXPIRES_AT_KEY, String(Date.now() + OAUTH_TRANSACTION_TTL_MS));

    // Normalize values so an optional protocol/trailing slash does not break OAuth.
    const normalizedDomain = cognitoDomain.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const normalizedAppUrl = appUrl.replace(/\/$/, '');
    const redirectUri = `${normalizedAppUrl}/auth/callback`;

    const params = new URLSearchParams({
      client_id: COGNITO_CLIENT_ID,
      response_type: 'code',
      scope: 'email openid profile',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      identity_provider: provider,
    });

    window.location.href = `https://${normalizedDomain}/oauth2/authorize?${params.toString()}`;
  },

  clearOAuthTransaction() {
    clearOAuthTransactionStorage();
  },

  consumeOAuthReturnTo(): string {
    const returnTo = readOAuthValue(OAUTH_RETURN_TO_KEY);
    removeOAuthValue(OAUTH_RETURN_TO_KEY);

    return returnTo?.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/dashboard';
  },

  async handleOAuthCallback(code: string, state: string): Promise<CognitoTokens> {
    const storedState = readOAuthValue(OAUTH_STATE_KEY);
    const codeVerifier = readOAuthValue(OAUTH_CODE_VERIFIER_KEY);
    const storedPreference = readOAuthValue(OAUTH_STORAGE_PREFERENCE_KEY);
    const expiresAt = Number(readOAuthValue(OAUTH_EXPIRES_AT_KEY));
    const storagePreference: AuthStoragePreference = storedPreference === 'persistent'
      ? 'persistent'
      : 'session';

    if (!storedState || storedState !== state || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      clearOAuthTransactionStorage();
      throw new Error('This sign-in request is invalid or expired. Start again from the sign-in page.');
    }

    if (!codeVerifier) {
      clearOAuthTransactionStorage();
      throw new Error('This sign-in request is incomplete. Start again from the sign-in page.');
    }

    clearOAuthTransactionStorage(false);

    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
    // Normalize domain - remove https:// prefix if present
    const normalizedDomain = cognitoDomain.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const normalizedAppUrl = import.meta.env.VITE_APP_URL.replace(/\/$/, '');
    const redirectUri = `${normalizedAppUrl}/auth/callback`;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: COGNITO_CLIENT_ID,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await fetch(`https://${normalizedDomain}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error_description || 'Token exchange failed');
    }

    const data = await response.json();

    const tokens: CognitoTokens = {
      IdToken: data.id_token,
      AccessToken: data.access_token,
      RefreshToken: data.refresh_token,
      ExpiresIn: data.expires_in,
    };

    if (!tokenStorage.setTokens(tokens, storagePreference)) {
      throw new Error('This browser could not store the authentication session');
    }
    return tokens;
  },
};

export default cognitoAuth;
