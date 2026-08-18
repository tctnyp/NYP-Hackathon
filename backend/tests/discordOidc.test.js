const { createHash, generateKeyPairSync, verify } = require('node:crypto');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}), { virtual: true });

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class MockCommand {
    constructor(input) {
      this.input = input;
    }
  }
  return {
    DeleteCommand: MockCommand,
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
    GetCommand: MockCommand,
    PutCommand: MockCommand,
  };
}, { virtual: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env.DISCORD_OIDC_TABLE = 'discord-oidc-test';
process.env.DISCORD_OIDC_ISSUER = 'https://api.example.com/prod/oidc/discord';
process.env.DISCORD_OIDC_CLIENT_ID = 'bridge-client';
process.env.DISCORD_OIDC_CLIENT_SECRET = 'bridge-secret';
process.env.DISCORD_OIDC_KEY_ID = 'test-key';
process.env.DISCORD_OIDC_PRIVATE_KEY_BASE64 = Buffer.from(privateKey).toString('base64');
process.env.DISCORD_OAUTH_CLIENT_ID = 'discord-client';
process.env.DISCORD_OAUTH_CLIENT_SECRET = 'discord-secret';
process.env.DISCORD_OAUTH_REDIRECT_URI = 'https://app.example.com/account/settings';
process.env.COGNITO_IDP_RESPONSE_URI = 'https://cognito.example.com/oauth2/idpresponse';
process.env.APP_URL = 'https://app.example.com';

const bridge = require('../src/handlers/discordOidc');

function event(path, method = 'GET', overrides = {}) {
  return {
    path,
    httpMethod: method,
    headers: {},
    ...overrides,
  };
}

function body(response) {
  return JSON.parse(response.body);
}

function hashedKey(type, token) {
  return `${type}#${createHash('sha256').update(token).digest('hex')}`;
}

describe('Discord OIDC bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('publishes OIDC discovery and an RSA signing key', async () => {
    const discovery = await bridge.handler(event('/oidc/discord/.well-known/openid-configuration'));
    const configuration = body(discovery);
    expect(discovery.statusCode).toBe(200);
    expect(configuration.issuer).toBe(process.env.DISCORD_OIDC_ISSUER);
    expect(configuration.authorization_endpoint).toBe(`${process.env.DISCORD_OIDC_ISSUER}/authorize`);
    expect(configuration.token_endpoint_auth_methods_supported).toContain('client_secret_basic');

    const jwks = await bridge.handler(event('/oidc/discord/jwks.json'));
    const key = body(jwks).keys[0];
    expect(jwks.statusCode).toBe(200);
    expect(key).toEqual(expect.objectContaining({ alg: 'RS256', kid: 'test-key', kty: 'RSA', use: 'sig' }));
  });

  test('starts Discord authorization with a hashed one-time transaction', async () => {
    mockSend.mockResolvedValueOnce({});
    const response = await bridge.handler(event('/oidc/discord/authorize', 'GET', {
      queryStringParameters: {
        client_id: 'bridge-client',
        redirect_uri: 'https://cognito.example.com/oauth2/idpresponse',
        response_type: 'code',
        scope: 'openid profile email',
        state: 'cognito-state',
        nonce: 'cognito-nonce',
      },
    }));

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.Location);
    const discordState = location.searchParams.get('state');
    expect(location.origin).toBe('https://discord.com');
    expect(location.searchParams.get('client_id')).toBe('discord-client');
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.example.com/account/settings');
    expect(discordState).toMatch(/^oidc\.[A-Za-z0-9_-]{43}$/);
    const stored = mockSend.mock.calls[0][0].input.Item;
    expect(stored.id).toBe(hashedKey('state', discordState));
    expect(JSON.stringify(stored)).not.toContain(discordState);
    expect(stored.cognito_state).toBe('cognito-state');
    expect(stored.nonce).toBe('cognito-nonce');
  });

  test('rejects untrusted OIDC clients and redirect URIs before persistence', async () => {
    const response = await bridge.handler(event('/oidc/discord/authorize', 'GET', {
      queryStringParameters: {
        client_id: 'attacker',
        redirect_uri: 'https://attacker.example/callback',
        response_type: 'code',
        scope: 'openid',
        state: 'state',
      },
    }));
    expect(response.statusCode).toBe(400);
    expect(body(response).error).toBe('unauthorized_client');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('exchanges the frontend handoff and stores no Discord provider tokens', async () => {
    mockSend
      .mockResolvedValueOnce({
        Attributes: {
          type: 'state',
          expires_at: Math.floor(Date.now() / 1000) + 60,
          client_id: 'bridge-client',
          cognito_redirect_uri: 'https://cognito.example.com/oauth2/idpresponse',
          cognito_state: 'cognito-state',
          nonce: 'nonce',
        },
      })
      .mockResolvedValueOnce({});
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'discord-access-secret', refresh_token: 'discord-refresh-secret' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'discord-user-id',
          username: 'student',
          global_name: 'Student Name',
          email: 'student@example.com',
          verified: true,
          avatar: 'avatar-hash',
        }),
      });

    const response = await bridge.handler(event('/oidc/discord/callback', 'POST', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'discord-code', state: 'oidc.frontend-state' }),
    }));
    const redirect = new URL(body(response).redirect_url);
    const bridgeCode = redirect.searchParams.get('code');
    expect(response.statusCode).toBe(200);
    expect(redirect.origin).toBe('https://cognito.example.com');
    expect(redirect.searchParams.get('state')).toBe('cognito-state');
    expect(bridgeCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockSend.mock.calls[0][0].input.Key.id).toBe(hashedKey('state', 'oidc.frontend-state'));
    const persisted = mockSend.mock.calls[1][0].input.Item;
    expect(persisted.id).toBe(hashedKey('code', bridgeCode));
    expect(persisted.claims).toEqual(expect.objectContaining({
      sub: 'discord-user-id',
      email: 'student@example.com',
      email_verified: true,
    }));
    expect(JSON.stringify(mockSend.mock.calls)).not.toContain('discord-access-secret');
    expect(JSON.stringify(mockSend.mock.calls)).not.toContain('discord-refresh-secret');
  });

  test('exchanges a bridge code once and signs a verifiable ID token', async () => {
    mockSend
      .mockResolvedValueOnce({
        Attributes: {
          type: 'code',
          expires_at: Math.floor(Date.now() / 1000) + 60,
          client_id: 'bridge-client',
          redirect_uri: 'https://cognito.example.com/oauth2/idpresponse',
          nonce: 'nonce-value',
          claims: {
            sub: 'discord-user-id',
            email: 'student@example.com',
            email_verified: true,
            name: 'Student Name',
            preferred_username: 'student',
          },
        },
      })
      .mockResolvedValueOnce({});
    const response = await bridge.handler(event('/oidc/discord/token', 'POST', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'bridge-code',
        redirect_uri: 'https://cognito.example.com/oauth2/idpresponse',
        client_id: 'bridge-client',
        client_secret: 'bridge-secret',
      }).toString(),
    }));
    const tokens = body(response);
    expect(response.statusCode).toBe(200);
    expect(tokens.token_type).toBe('Bearer');
    const [header, payload, signature] = tokens.id_token.split('.');
    expect(verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    )).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    expect(claims).toEqual(expect.objectContaining({
      iss: process.env.DISCORD_OIDC_ISSUER,
      aud: 'bridge-client',
      sub: 'discord-user-id',
      nonce: 'nonce-value',
      email_verified: true,
    }));
    expect(mockSend.mock.calls[0][0].input.Key.id).toBe(hashedKey('code', 'bridge-code'));
    expect(mockSend.mock.calls[1][0].input.Item.id).toBe(hashedKey('access', tokens.access_token));
  });

  test('returns userinfo only for a valid stored bearer token', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        type: 'access',
        expires_at: Math.floor(Date.now() / 1000) + 60,
        claims: { sub: 'discord-user-id', email: 'student@example.com' },
      },
    });
    const response = await bridge.handler(event('/oidc/discord/userinfo', 'GET', {
      headers: { Authorization: 'Bearer access-token' },
    }));
    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual({ sub: 'discord-user-id', email: 'student@example.com' });
    expect(mockSend.mock.calls[0][0].input.Key.id).toBe(hashedKey('access', 'access-token'));
  });

  test.each([
    ['malformed private-key base64', { DISCORD_OIDC_PRIVATE_KEY_BASE64: 'not-canonical-base64!' }],
    ['non-RSA private key', {
      DISCORD_OIDC_PRIVATE_KEY_BASE64: Buffer.from(generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey).toString('base64'),
    }],
    ['weak RSA private key', {
      DISCORD_OIDC_PRIVATE_KEY_BASE64: Buffer.from(generateKeyPairSync('rsa', {
        modulusLength: 1024,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey).toString('base64'),
    }],
    ['mismatched frontend redirect', { DISCORD_OAUTH_REDIRECT_URI: 'https://other.example.com/account/settings' }],
    ['untrusted Cognito redirect', { COGNITO_IDP_RESPONSE_URI: 'http://cognito.example.com/oauth2/idpresponse' }],
  ])('fails closed for %s', async (_label, overrides) => {
    const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let isolatedBridge;
    jest.isolateModules(() => {
      isolatedBridge = require('../src/handlers/discordOidc');
    });
    Object.assign(process.env, previous);

    const response = await isolatedBridge.handler(event('/oidc/discord/jwks.json'));
    expect(response.statusCode).toBe(503);
    expect(body(response)).toEqual({
      error: 'temporarily_unavailable',
      error_description: 'Discord authentication is not configured',
    });
  });

});