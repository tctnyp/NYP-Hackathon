const { createHash } = require('node:crypto');

const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
const mockUpdateItem = jest.fn();
const mockDocumentSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('../src/utils/database', () => ({
  docClient: { send: mockDocumentSend },
  getItem: mockGetItem,
  putItem: mockPutItem,
  updateItem: mockUpdateItem,
  USERS_TABLE: 'users-test',
  timestamp: () => '2026-08-18T10:00:00.000Z',
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class MockCommand {
    constructor(input) {
      this.input = input;
    }
  }
  return {
    AdminDisableProviderForUserCommand: MockCommand,
    AdminLinkProviderForUserCommand: MockCommand,
    CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  };
}, { virtual: true });

process.env.USER_POOL_ID = 'pool-test';
process.env.DISCORD_OAUTH_CLIENT_ID = 'discord-client';
process.env.DISCORD_OAUTH_CLIENT_SECRET = 'discord-secret';
process.env.DISCORD_OAUTH_REDIRECT_URI = 'https://nypxaws.tancheetiong.com/account/settings';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://nypxaws.tancheetiong.com/account/settings';
process.env.CALENDAR_CONNECTIONS_TABLE = 'calendar-test';

const account = require('../src/handlers/account');

function event(body, claimOverrides = {}) {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          email: 'student@example.com',
          name: 'Student Name',
          auth_time: Math.floor(Date.now() / 1000),
          'cognito:username': 'student',
          ...claimOverrides,
        },
      },
    },
  };
}

function responseData(response) {
  return JSON.parse(response.body).data;
}

const existingProfile = {
  user_id: 'user-123',
  email: 'old@example.com',
  display_name: 'Student',
  full_name: 'Student Name',
  profile_picture: null,
  preferences: {},
  oauth_state_discord: { state_hash: 'private', expires_at: 1 },
  oauth_connection_discord: {
    provider_user_id: 'discord-private-id',
    username: 'student123',
    display_name: 'Student',
    connected_at: '2026-08-18T09:00:00.000Z',
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-18T09:00:00.000Z',
};

describe('account handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue({ ...existingProfile });
    mockPutItem.mockImplementation(async (_table, item) => item);
    mockUpdateItem.mockImplementation(async (_table, _key, updates) => ({
      ...existingProfile,
      ...updates,
    }));
    mockDocumentSend.mockResolvedValue({ Attributes: { ...existingProfile } });
    mockCognitoSend.mockResolvedValue({});
    global.fetch = jest.fn();
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('GET returns safe connection details and recognizes Google-origin claims', async () => {
    const response = await account.getProfile(event(undefined, {
      'cognito:username': 'Google_abc123',
      identities: JSON.stringify([{ providerName: 'Google', userId: 'google-private-id' }]),
    }));
    const data = responseData(response);

    expect(response.statusCode).toBe(200);
    expect(data.profile.email).toBe('student@example.com');
    expect(data.profile.oauth_state_discord).toBeUndefined();
    expect(data.profile.oauth_connection_discord).toBeUndefined();
    expect(data.connections.discord).toEqual(expect.objectContaining({
      connected: true,
      username: 'student123',
    }));
    expect(data.connections.discord.provider_user_id).toBeUndefined();
    expect(data.connections.google.connected).toBe(true);
    expect(data.connections.google.available).toBe(true);
    expect(data.connections.google.disconnect_allowed).toBe(false);
    expect(data.connections.discord.available).toBe(true);
    expect(data.connections.discord.disconnect_allowed).toBe(true);
    expect(data.password_change_available).toBe(false);
  });

  test('updates only validated account profile fields', async () => {
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
    const response = await account.upsertProfile(event({
      display_name: '  New display  ',
      full_name: '  New Name  ',
      profile_picture: png,
    }));

    expect(response.statusCode).toBe(200);
    expect(mockPutItem).toHaveBeenCalledWith('users-test', expect.objectContaining({
      display_name: 'New display',
      full_name: 'New Name',
      profile_picture: png,
    }));

    const rejected = await account.upsertProfile(event({ role: 'admin' }));
    expect(rejected.statusCode).toBe(400);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });

  test('rejects mislabeled or oversized profile pictures', async () => {
    const mislabeled = `data:image/jpeg;base64,${Buffer.from('not a jpeg').toString('base64')}`;
    const response = await account.upsertProfile(event({ profile_picture: mislabeled }));
    expect(response.statusCode).toBe(400);

    const oversized = `data:image/png;base64,${'A'.repeat(200 * 1024)}`;
    const oversizedResponse = await account.upsertProfile(event({ profile_picture: oversized }));
    expect(oversizedResponse.statusCode).toBe(400);
  });

  test.each([
    ['missing', undefined],
    ['stale', Math.floor(Date.now() / 1000) - 3600],
  ])('requires recent authentication when OAuth auth_time is %s', async (_label, authTime) => {
    const response = await account.upsertProfile(event(
      { action: 'oauthAuthorize', provider: 'discord' },
      { auth_time: authTime },
    ));

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error).toMatch(/sign in again/i);
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  test('stale callback authentication does not consume state or call a provider', async () => {
    const response = await account.upsertProfile(event(
      { action: 'oauthCallback', code: 'code', state: 'discord.state' },
      { auth_time: Math.floor(Date.now() / 1000) - 3600 },
    ));

    expect(response.statusCode).toBe(403);
    expect(mockDocumentSend).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('missing disconnect authentication does not unlink or remove a connection', async () => {
    const response = await account.upsertProfile(event(
      { action: 'disconnect', provider: 'discord' },
      { auth_time: undefined },
    ));

    expect(response.statusCode).toBe(403);
    expect(mockDocumentSend).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  test('oauthAuthorize stores only a short-lived user-bound state hash', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await account.upsertProfile(event({ action: 'oauthAuthorize', provider: 'discord' }));
    const data = responseData(response);
    const url = new URL(data.authorization_url);
    const state = url.searchParams.get('state');
    const updates = mockUpdateItem.mock.calls[0][2];

    expect(response.statusCode).toBe(200);
    expect(url.origin).toBe('https://discord.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://nypxaws.tancheetiong.com/account/settings');
    expect(state).toMatch(/^discord\.[A-Za-z0-9_-]{43}$/);
    expect(updates.oauth_state_discord.state_hash).toBe(
      createHash('sha256').update(`user-123\0${state}`).digest('hex'),
    );
    expect(JSON.stringify(updates)).not.toContain(state);
    expect(updates.oauth_state_discord.expires_at).toBeGreaterThanOrEqual(now + 590);
    expect(updates.oauth_state_discord.expires_at).toBeLessThanOrEqual(now + 610);
  });

  test('Discord callback consumes state and never persists provider tokens', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'discord-access-secret', refresh_token: 'discord-refresh-secret' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'discord-id', username: 'student123', global_name: 'Student' }) });

    const response = await account.upsertProfile(event({
      action: 'oauthCallback',
      code: 'authorization-code',
      state: 'discord.random-state',
    }));

    expect(response.statusCode).toBe(200);
    expect(mockDocumentSend).toHaveBeenCalledTimes(1);
    expect(mockDocumentSend.mock.calls[0][0].input).toEqual(expect.objectContaining({
      ConditionExpression: expect.stringContaining('#oauth_state.#state_hash'),
    }));
    const persisted = mockUpdateItem.mock.calls[0][2].oauth_connection_discord;
    expect(persisted).toEqual(expect.objectContaining({
      provider_user_id: 'discord-id',
      username: 'student123',
      cognito_linked: true,
    }));
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'student' },
        SourceUser: {
          ProviderName: 'Discord',
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: 'discord-id',
        },
      }),
    }));
    expect(JSON.stringify(mockUpdateItem.mock.calls)).not.toContain('discord-access-secret');
    expect(JSON.stringify(mockUpdateItem.mock.calls)).not.toContain('discord-refresh-secret');
  });

  test('links Discord to a Google-origin destination using the Google provider subject', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'discord-access-secret' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'discord-subject', username: 'student123' }) });

    const response = await account.upsertProfile(event(
      { action: 'oauthCallback', code: 'discord-code', state: 'discord.random-state' },
      {
        'cognito:username': 'Google_primary',
        identities: JSON.stringify([{ providerName: 'Google', userId: 'google-subject' }]),
      },
    ));

    expect(response.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'google-subject' },
        SourceUser: expect.objectContaining({ ProviderName: 'Discord', ProviderAttributeValue: 'discord-subject' }),
      }),
    }));
    expect(mockUpdateItem.mock.calls[0][2].oauth_connection_discord.cognito_linked).toBe(true);
  });

  test('Google callback verifies email and links the identity with Cognito', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'google-access-secret' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google-subject',
          email: 'student@example.com',
          email_verified: true,
          name: 'Student Name',
        }),
      });

    const response = await account.upsertProfile(event({
      action: 'oauthCallback',
      code: 'google-code',
      state: 'google.random-state',
    }));

    expect(response.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        UserPoolId: 'pool-test',
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'student' },
        SourceUser: {
          ProviderName: 'Google',
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: 'google-subject',
        },
      }),
    }));
    expect(JSON.stringify(mockUpdateItem.mock.calls)).not.toContain('google-access-secret');
  });

  test('links Google to a Discord-origin destination using the Discord provider subject', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'google-access-secret' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google-subject',
          email: 'student@example.com',
          email_verified: true,
          name: 'Student Name',
        }),
      });

    const response = await account.upsertProfile(event(
      { action: 'oauthCallback', code: 'google-code', state: 'google.random-state' },
      {
        'cognito:username': 'Discord_primary',
        identities: JSON.stringify([{ providerName: 'Discord', userId: 'discord-subject' }]),
      },
    ));

    expect(response.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'discord-subject' },
        SourceUser: expect.objectContaining({ ProviderName: 'Google', ProviderAttributeValue: 'google-subject' }),
      }),
    }));
  });

  test('disconnects a Cognito-linked Discord identity from a local account', async () => {
    mockGetItem.mockResolvedValueOnce({
      ...existingProfile,
      oauth_connection_discord: {
        ...existingProfile.oauth_connection_discord,
        cognito_linked: true,
      },
    });
    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'discord' }));

    expect(response.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        UserPoolId: 'pool-test',
        User: {
          ProviderName: 'Discord',
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: 'discord-private-id',
        },
      },
    }));
    expect(mockDocumentSend).toHaveBeenCalled();
  });

  test('does not allow a Discord-origin user to disconnect their primary sign-in', async () => {
    const response = await account.upsertProfile(event(
      { action: 'disconnect', provider: 'discord' },
      {
        'cognito:username': 'Discord_primary',
        identities: JSON.stringify([{ providerName: 'Discord', userId: 'discord-primary' }]),
      },
    ));
    const data = responseData(await account.getProfile(event(undefined, {
      'cognito:username': 'Discord_primary',
      identities: JSON.stringify([{ providerName: 'Discord', userId: 'discord-primary' }]),
    })));

    expect(response.statusCode).toBe(409);
    expect(data.connections.discord.connected).toBe(true);
    expect(data.connections.discord.disconnect_allowed).toBe(false);
    expect(data.password_change_available).toBe(false);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  test('requires Calendar cleanup before disconnecting a linked Google identity', async () => {
    mockGetItem.mockResolvedValueOnce({
      ...existingProfile,
      oauth_connection_google: { provider_user_id: 'google-subject', email: 'student@example.com' },
    });
    mockDocumentSend.mockResolvedValueOnce({
      Item: { user_id: 'user-123', status: 'enabled', encrypted_refresh_token: { ciphertext: 'encrypted' } },
    });

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'google' }));
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error).toMatch(/disable google calendar/i);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  test('does not allow a Google-origin user to disconnect their primary sign-in', async () => {
    const response = await account.upsertProfile(event(
      { action: 'disconnect', provider: 'google' },
      { 'cognito:username': 'Google_primary' },
    ));

    expect(response.statusCode).toBe(409);
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockDocumentSend).not.toHaveBeenCalled();
  });
});
