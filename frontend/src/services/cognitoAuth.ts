// Dependency-free Cognito authentication client using fetch API

const COGNITO_REGION = import.meta.env.VITE_COGNITO_REGION;
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

const COGNITO_IDP_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

interface CognitoTokens {
  IdToken: string;
  AccessToken: string;
  RefreshToken: string;
  ExpiresIn: number;
}

interface ChallengeResponse {
  ChallengeName: string;
  Session: string;
  ChallengeParameters: Record<string, string>;
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

// Token storage in sessionStorage
export const tokenStorage = {
  setTokens(tokens: CognitoTokens) {
    sessionStorage.setItem('idToken', tokens.IdToken);
    sessionStorage.setItem('accessToken', tokens.AccessToken);
    sessionStorage.setItem('refreshToken', tokens.RefreshToken);
    sessionStorage.setItem('tokenExpiry', (Date.now() + tokens.ExpiresIn * 1000).toString());
  },

  getIdToken(): string | null {
    return sessionStorage.getItem('idToken');
  },

  getAccessToken(): string | null {
    return sessionStorage.getItem('accessToken');
  },

  getRefreshToken(): string | null {
    return sessionStorage.getItem('refreshToken');
  },

  getTokenExpiry(): number | null {
    const expiry = sessionStorage.getItem('tokenExpiry');
    return expiry ? parseInt(expiry, 10) : null;
  },

  clearTokens() {
    sessionStorage.removeItem('idToken');
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('tokenExpiry');
  },

  isTokenExpired(): boolean {
    const expiry = this.getTokenExpiry();
    if (!expiry) return true;
    return Date.now() >= expiry - 60000; // Refresh 1 minute before expiry
  },
};

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

  async signIn(username: string, password: string): Promise<CognitoTokens | ChallengeResponse> {
    const data = await cognitoRequest('AWSCognitoIdentityProviderService.InitiateAuth', {
      ClientId: COGNITO_CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    });

    if (data.AuthenticationResult) {
      const tokens: CognitoTokens = {
        IdToken: data.AuthenticationResult.IdToken,
        AccessToken: data.AuthenticationResult.AccessToken,
        RefreshToken: data.AuthenticationResult.RefreshToken,
        ExpiresIn: data.AuthenticationResult.ExpiresIn,
      };
      tokenStorage.setTokens(tokens);
      return tokens;
    }

    // Handle challenges (e.g., NEW_PASSWORD_REQUIRED)
    return {
      ChallengeName: data.ChallengeName,
      Session: data.Session,
      ChallengeParameters: data.ChallengeParameters || {},
    };
  },

  async refreshTokens(): Promise<CognitoTokens> {
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

    tokenStorage.setTokens(tokens);
    return tokens;
  },

  async signOut(): Promise<void> {
    const accessToken = tokenStorage.getAccessToken();
    if (accessToken) {
      try {
        await cognitoRequest('AWSCognitoIdentityProviderService.GlobalSignOut', {
          AccessToken: accessToken,
        });
      } catch (e) {
        // Ignore errors on sign out
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

    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = generateState();

    // Store transient values for the callback. Only local app paths are accepted.
    const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/dashboard';
    sessionStorage.setItem('pkce_code_verifier', codeVerifier);
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_return_to', safeReturnTo);

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

  consumeOAuthReturnTo(): string {
    const returnTo = sessionStorage.getItem('oauth_return_to');
    sessionStorage.removeItem('oauth_return_to');

    return returnTo?.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/dashboard';
  },

  async handleOAuthCallback(code: string, state: string): Promise<CognitoTokens> {
    const storedState = sessionStorage.getItem('oauth_state');
    const codeVerifier = sessionStorage.getItem('pkce_code_verifier');

    if (!storedState || storedState !== state) {
      throw new Error('Invalid state parameter');
    }

    if (!codeVerifier) {
      throw new Error('No code verifier found');
    }

    // Clean up
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('pkce_code_verifier');

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

    tokenStorage.setTokens(tokens);
    return tokens;
  },
};

export default cognitoAuth;
