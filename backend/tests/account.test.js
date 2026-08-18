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
    mockDocumentSend.mockReset();
    mockCognitoSend.mockReset();
    mockGetItem.mockResolvedValue({ ...existingProfile });
    mockPutItem.mockImplementation(async (_table, item) => item);
    mockUpdateItem.mockImplementation(async (_table, _key, updates) => ({
      ...existingProfile,
      ...updates,
    }));
    mockDocumentSend.mockImplementation(async (command) => {
      const input = command.input || {};
      if (input.ReturnValues === 'ALL_OLD') {
        return {
          Attributes: {
            ...existingProfile,
            oauth_state_discord: { link_generation: 'generation-test' },
            oauth_state_google: { link_generation: 'generation-test' },
          },
        };
      }
      if (input.ReturnValues === 'ALL_NEW') {
        const attributes = { ...existingProfile };
        const connectionName = input.ExpressionAttributeNames?.['#connection'];
        if (connectionName && input.ExpressionAttributeValues?.[':connection']) {
          attributes[connectionName] = input.ExpressionAttributeValues[':connection'];
        }
        return { Attributes: attributes };
      }
      return {};
    });
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
    expect(mockDocumentSend).toHaveBeenCalledTimes(4);
    expect(mockDocumentSend.mock.calls[0][0].input).toEqual(expect.objectContaining({
      ConditionExpression: expect.stringContaining('#oauth_state.#state_hash'),
    }));
    const persisted = mockDocumentSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.ExpressionAttributeValues?.[':connection']?.provider_user_id === 'discord-id')
      .ExpressionAttributeValues[':connection'];
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
    expect(JSON.stringify(mockDocumentSend.mock.calls)).not.toContain('discord-access-secret');
    expect(JSON.stringify(mockDocumentSend.mock.calls)).not.toContain('discord-refresh-secret');
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
    expect(mockDocumentSend.mock.calls.some(([command]) => command.input.ExpressionAttributeValues?.[':connection']?.cognito_linked === true)).toBe(true);
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
    expect(JSON.stringify(mockDocumentSend.mock.calls)).not.toContain('google-access-secret');
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
    mockGetItem.mockResolvedValue({
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

  test('does not mark a recovered missing profile as a first signup', async () => {
    mockGetItem.mockResolvedValueOnce(undefined);
    const response = await account.upsertProfile(event({ display_name: 'Recovered student' }));

    expect(response.statusCode).toBe(200);
    expect(mockPutItem.mock.calls[0][1].preferences).toEqual({});
    expect(mockPutItem.mock.calls[0][1].preferences.onboarding_required).toBeUndefined();
  });

  test('persists walkthrough completion without replacing unrelated preferences', async () => {
    mockGetItem.mockResolvedValueOnce({
      ...existingProfile,
      preferences: { onboarding_required: true, notification_guidance: true },
    });
    mockDocumentSend.mockResolvedValueOnce({
      Attributes: {
        ...existingProfile,
        preferences: { onboarding_required: false, onboarding_version: 1, notification_guidance: true },
      },
    });
    const response = await account.upsertProfile(event({ action: 'completeOnboarding', version: 1 }));

    expect(response.statusCode).toBe(200);
    const update = mockDocumentSend.mock.calls[0][0].input;
    expect(update.UpdateExpression).toContain('#preferences.#required = :false');
    expect(update.UpdateExpression).toContain('#preferences.#version = :version');
    expect(update.ExpressionAttributeValues).toEqual(expect.objectContaining({ ':false': false, ':version': 1 }));
    expect(responseData(response).profile.preferences).toEqual(expect.objectContaining({
      onboarding_required: false,
      onboarding_version: 1,
    }));

    const invalid = await account.upsertProfile(event({ action: 'completeOnboarding', version: 0 }));
    expect(invalid.statusCode).toBe(400);
  });

  test('requires Calendar cleanup before disconnecting a linked Google identity', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_google: { provider_user_id: 'google-subject', email: 'student@example.com' },
    });
    const transactionCanceled = Object.assign(new Error('Calendar state exists'), { name: 'TransactionCanceledException' });
    mockDocumentSend.mockRejectedValueOnce(transactionCanceled);

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'google' }));
    const transaction = mockDocumentSend.mock.calls[0][0].input.TransactItems;
    expect(transaction[0].Update.TableName).toBe('users-test');
    expect(transaction[1].ConditionCheck).toEqual(expect.objectContaining({
      TableName: 'calendar-test',
      ConditionExpression: 'attribute_not_exists(#user_id)',
    }));
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error).toMatch(/calendar cleanup/i);
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  test('resumes an unlinking Google connection without disabling Cognito twice', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_google: {
        provider_user_id: 'google-subject',
        email: 'student@example.com',
        link_version: 'version-1',
        status: 'unlinking',
        disable_completed: true,
      },
    });
    mockDocumentSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...existingProfile, oauth_connection_google: undefined } });

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'google' }));
    expect(response.statusCode).toBe(200);
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

  test('rejects an OAuth callback when disconnect invalidates its link generation', async () => {
    const changedOperation = Object.assign(new Error('operation changed'), { name: 'ConditionalCheckFailedException' });
    mockDocumentSend
      .mockResolvedValueOnce({
        Attributes: { oauth_state_google: { link_generation: 'generation-test' } },
      })
      .mockRejectedValueOnce(changedOperation);

    const response = await account.upsertProfile(event({
      action: 'oauthCallback',
      code: 'google-code',
      state: 'google.random-state',
    }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/operation changed/i);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  test('keeps an ambiguous Google unlink in unlinking state for a safe retry', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_google: {
        provider_user_id: 'google-subject',
        email: 'student@example.com',
        status: 'active',
      },
    });
    mockCognitoSend.mockRejectedValueOnce(new Error('Cognito timeout'));

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'google' }));
    expect(response.statusCode).toBe(500);
    expect(mockDocumentSend.mock.calls.some(([command]) => (
      command.input.TransactItems?.[0]?.Update?.ExpressionAttributeValues?.[':connection']?.status === 'unlinking'
    ))).toBe(true);
    expect(mockDocumentSend.mock.calls.some(([command]) => command.input.UpdateExpression === 'REMOVE #connection SET #updated_at = :updated_at')).toBe(false);
  });

  test('keeps an ambiguous Discord unlink in unlinking state for a safe retry', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_discord: {
        ...existingProfile.oauth_connection_discord,
        cognito_linked: true,
        status: 'active',
      },
    });
    mockCognitoSend.mockRejectedValueOnce(new Error('Cognito timeout'));

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'discord' }));
    expect(response.statusCode).toBe(500);
    expect(mockDocumentSend.mock.calls.some(([command]) => (
      command.input.ExpressionAttributeValues?.[':connection']?.status === 'unlinking'
    ))).toBe(true);
    expect(mockDocumentSend.mock.calls.some(([command]) => command.input.UpdateExpression === 'REMOVE #connection SET #updated_at = :updated_at')).toBe(false);
  });

  test('resumes Discord metadata cleanup after provider disable completed', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_discord: {
        ...existingProfile.oauth_connection_discord,
        cognito_linked: true,
        status: 'unlinking',
        disable_completed: true,
      },
    });

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'discord' }));
    expect(response.statusCode).toBe(200);
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockDocumentSend.mock.calls.some(([command]) => command.input.UpdateExpression === 'REMOVE #connection SET #updated_at = :updated_at')).toBe(true);
  });

  test('preserves a staged Discord subject if Cognito linking succeeds before metadata finalization fails', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'discord-access-secret' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'discord-staged-id', username: 'student123' }) });
    const databaseFailure = new Error('metadata write failed');
    const preserveStaged = Object.assign(new Error('staged provider exists'), { name: 'ConditionalCheckFailedException' });
    mockDocumentSend
      .mockResolvedValueOnce({ Attributes: { oauth_state_discord: { link_generation: 'generation-test' } } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

      .mockRejectedValueOnce(databaseFailure)
      .mockRejectedValueOnce(preserveStaged);

    const response = await account.upsertProfile(event({
      action: 'oauthCallback', code: 'discord-code', state: 'discord.random-state',
    }));

    expect(response.statusCode).toBe(500);
    expect(mockCognitoSend).toHaveBeenCalledTimes(1);
    const staged = mockDocumentSend.mock.calls[2][0].input.ExpressionAttributeValues[':connection'];
    expect(staged).toEqual(expect.objectContaining({
      provider_user_id: 'discord-staged-id',
      status: 'linking',
      operation_expires_at: expect.any(Number),
      cognito_link_attempted: true,
      cognito_linked: true,
    }));
    expect(mockDocumentSend.mock.calls[4][0].input.ConditionExpression).toContain('attribute_not_exists(#connection.#provider)');
  });

  test.each([
    'AliasExistsException',
    'InvalidParameterException',
    'ResourceConflictException',
  ])('clears the staged Google identity after definitive Cognito %s', async (errorName) => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'google-access-secret' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google-definitive-failure',
          email: 'student@example.com',
          email_verified: true,
          name: 'Student Name',
        }),
      });
    mockCognitoSend.mockRejectedValueOnce(Object.assign(new Error('definitive link failure'), { name: errorName }));

    const response = await account.upsertProfile(event({
      action: 'oauthCallback', code: 'google-code', state: 'google.random-state',
    }));

    expect(response.statusCode).toBe(409);
    const release = mockDocumentSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.ExpressionAttributeValues?.[':provider'] === 'google-definitive-failure');
    expect(release).toEqual(expect.objectContaining({
      UpdateExpression: 'REMOVE #connection SET #updated_at = :updated_at',
      ConditionExpression: expect.stringContaining('#connection.#provider = :provider'),
    }));
    expect(release.ExpressionAttributeValues).toEqual(expect.objectContaining({
      ':generation': 'generation-test',
      ':provider': 'google-definitive-failure',
    }));
  });

  test('preserves a staged Google identity when Cognito linking times out ambiguously', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'google-access-secret' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google-ambiguous-link',
          email: 'student@example.com',
          email_verified: true,
          name: 'Student Name',
        }),
      });
    mockCognitoSend.mockRejectedValueOnce(new Error('Cognito timeout'));

    const response = await account.upsertProfile(event({
      action: 'oauthCallback', code: 'google-code', state: 'google.random-state',
    }));

    expect(response.statusCode).toBe(500);
    const release = mockDocumentSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.UpdateExpression === 'REMOVE #connection SET #updated_at = :updated_at');
    expect(release.ConditionExpression).toContain('attribute_not_exists(#connection.#provider)');
    expect(release.ExpressionAttributeValues[':provider']).toBeUndefined();
  });

  test('allows disconnect recovery only after a staged Discord linking lease expires', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_discord: {
        provider_user_id: 'discord-staged-id',
        status: 'linking',
        operation_expires_at: Math.floor(Date.now() / 1000) - 1,
        cognito_link_attempted: true,
        cognito_linked: true,
      },
    });

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'discord' }));
    expect(response.statusCode).toBe(200);
    const begin = mockDocumentSend.mock.calls[0][0].input;
    expect(begin.ConditionExpression).toContain('#operation_expires_at < :now');
    expect(mockCognitoSend).toHaveBeenCalled();
  });

  test('disconnects a non-primary Discord identity from Cognito claims when local metadata is missing', async () => {
    const profileWithoutDiscord = { ...existingProfile };
    delete profileWithoutDiscord.oauth_connection_discord;
    mockGetItem.mockResolvedValue(profileWithoutDiscord);

    const response = await account.upsertProfile(event(
      { action: 'disconnect', provider: 'discord' },
      { identities: JSON.stringify([{ providerName: 'Discord', userId: 'discord-claim-id' }]) },
    ));

    expect(response.statusCode).toBe(200);
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        User: expect.objectContaining({
          ProviderName: 'Discord',
          ProviderAttributeValue: 'discord-claim-id',
        }),
      }),
    }));
  });

});
