const { createHash } = require('node:crypto');

const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
const mockUpdateItem = jest.fn();
const mockDocumentSend = jest.fn();
const mockCognitoSend = jest.fn();
const mockDeleteOwnedMedia = jest.fn();
const mockPromoteUpload = jest.fn();
const mockSignedMediaUrl = jest.fn();
const mockMediaError = class MediaError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
};

jest.mock('../src/utils/database', () => ({
  docClient: { send: mockDocumentSend },
  getItem: mockGetItem,
  putItem: mockPutItem,
  updateItem: mockUpdateItem,
  USERS_TABLE: 'users-test',
  timestamp: () => '2026-08-18T10:00:00.000Z',
}));

jest.mock('../src/utils/mediaStorage', () => ({
  MediaError: mockMediaError,
  deleteOwnedMedia: mockDeleteOwnedMedia,
  promoteUpload: mockPromoteUpload,
  signedMediaUrl: mockSignedMediaUrl,
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
process.env.NATIVE_EMAIL_MFA_ENABLED = 'false';

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
    process.env.NATIVE_EMAIL_MFA_ENABLED = 'false';
    mockDocumentSend.mockReset();
    mockCognitoSend.mockReset();
    mockDeleteOwnedMedia.mockReset().mockResolvedValue(undefined);
    mockPromoteUpload.mockReset();
    mockSignedMediaUrl.mockReset();
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
    expect(data.native_mfa).toEqual({
      available: false,
      totp_available: false,
      email_available: false,
      provider_managed: 'google',
    });
  });

  test('GET recognizes a Discord-origin user without requiring a second OAuth link', async () => {
    const profileWithoutDiscord = { ...existingProfile };
    delete profileWithoutDiscord.oauth_connection_discord;
    mockGetItem.mockResolvedValueOnce(profileWithoutDiscord);

    const response = await account.getProfile(event(undefined, {
      'cognito:username': 'Discord_discord-user-id',
      preferred_username: 'student123',
      identities: JSON.stringify([{ providerName: 'Discord', userId: 'discord-user-id' }]),
    }));
    const data = responseData(response);

    expect(response.statusCode).toBe(200);
    expect(data.connections.discord).toEqual(expect.objectContaining({
      connected: true,
      display_name: 'Student Name',
      email: 'student@example.com',
      disconnect_allowed: false,
    }));
    expect(data.connections.discord.provider_user_id).toBeUndefined();
    expect(data.password_change_available).toBe(false);
    expect(data.native_mfa).toEqual({
      available: false,
      totp_available: false,
      email_available: false,
      provider_managed: 'discord',
    });
  });

  test('GET exposes TOTP for local users and gates email MFA through resolved infrastructure configuration', async () => {
    let data = responseData(await account.getProfile(event()));
    expect(data.native_mfa).toEqual({
      available: true,
      totp_available: true,
      email_available: false,
      provider_managed: null,
    });

    process.env.NATIVE_EMAIL_MFA_ENABLED = 'true';
    data = responseData(await account.getProfile(event()));
    expect(data.native_mfa.email_available).toBe(true);
  });

  test('updates validated profile fields, promotes a staged picture, and returns its signed URL', async () => {
    const owner = 'a'.repeat(40);
    const uploadKey = `uploads/${owner}/profile_photo/pending.png`;
    const oldPictureKey = `media/${owner}/profile_photo/old.png`;
    const newPictureKey = `media/${owner}/profile_photo/new.png`;
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      profile_picture: 'data:image/png;base64,legacy',
      profile_picture_key: oldPictureKey,
    });
    mockPromoteUpload.mockResolvedValue({ objectKey: newPictureKey, mediaType: 'image/png', size: 128 });
    mockSignedMediaUrl.mockResolvedValue({ url: 'https://signed.example/new.png' });

    const response = await account.upsertProfile(event({
      display_name: '  New display  ',
      full_name: '  New Name  ',
      profile_picture_upload_key: uploadKey,
    }));

    expect(response.statusCode).toBe(200);
    expect(mockPromoteUpload).toHaveBeenCalledWith('user-123', uploadKey, 'profile_photo');
    expect(mockPutItem).toHaveBeenCalledWith('users-test', expect.objectContaining({
      display_name: 'New display',
      full_name: 'New Name',
      profile_picture_key: newPictureKey,
    }));
    const persisted = mockPutItem.mock.calls[0][1];
    expect(persisted).not.toHaveProperty('profile_picture');
    expect(mockDeleteOwnedMedia).toHaveBeenCalledWith('user-123', oldPictureKey, 'profile_photo', true);
    expect(mockSignedMediaUrl).toHaveBeenCalledWith('user-123', newPictureKey, 'profile_photo');
    expect(responseData(response).profile.profile_picture).toBe('https://signed.example/new.png');

    const rejected = await account.upsertProfile(event({ role: 'admin' }));
    expect(rejected.statusCode).toBe(400);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });

  test('GET resolves a durable profile picture to a signed URL', async () => {
    const pictureKey = `media/${'b'.repeat(40)}/profile_photo/avatar.webp`;
    mockGetItem.mockResolvedValue({ ...existingProfile, profile_picture_key: pictureKey });
    mockSignedMediaUrl.mockResolvedValue({ url: 'https://signed.example/avatar.webp' });

    const response = await account.getProfile(event());

    expect(response.statusCode).toBe(200);
    expect(mockSignedMediaUrl).toHaveBeenCalledWith('user-123', pictureKey, 'profile_photo');
    expect(responseData(response).profile.profile_picture).toBe('https://signed.example/avatar.webp');
    expect(responseData(response).profile.profile_picture_key).toBe(pictureKey);
  });

  test('removes a durable profile picture and its legacy inline value', async () => {
    const oldPictureKey = `media/${'c'.repeat(40)}/profile_photo/old.jpg`;
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      profile_picture: 'data:image/jpeg;base64,legacy',
      profile_picture_key: oldPictureKey,
    });

    const response = await account.upsertProfile(event({ profile_picture_upload_key: null }));

    expect(response.statusCode).toBe(200);
    const persisted = mockPutItem.mock.calls[0][1];
    expect(persisted).not.toHaveProperty('profile_picture');
    expect(persisted).not.toHaveProperty('profile_picture_key');
    expect(mockDeleteOwnedMedia).toHaveBeenCalledWith('user-123', oldPictureKey, 'profile_photo', true);
    expect(mockSignedMediaUrl).not.toHaveBeenCalled();
    expect(responseData(response).profile.profile_picture).toBeNull();
  });

  test('rolls back a promoted profile picture when persistence fails', async () => {
    const owner = 'd'.repeat(40);
    const uploadKey = `uploads/${owner}/profile_photo/pending.jpg`;
    const oldPictureKey = `media/${owner}/profile_photo/old.jpg`;
    const promotedPictureKey = `media/${owner}/profile_photo/promoted.jpg`;
    mockGetItem.mockResolvedValue({ ...existingProfile, profile_picture_key: oldPictureKey });
    mockPromoteUpload.mockResolvedValue({ objectKey: promotedPictureKey, mediaType: 'image/jpeg', size: 256 });
    mockPutItem.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await account.upsertProfile(event({ profile_picture_upload_key: uploadKey }));

    expect(response.statusCode).toBe(500);
    expect(mockDeleteOwnedMedia).toHaveBeenCalledTimes(1);
    expect(mockDeleteOwnedMedia).toHaveBeenCalledWith('user-123', promotedPictureKey, 'profile_photo', true);
    expect(mockDeleteOwnedMedia).not.toHaveBeenCalledWith('user-123', oldPictureKey, 'profile_photo', true);
    expect(mockSignedMediaUrl).not.toHaveBeenCalled();
  });

  test('rejects legacy base64 pictures and invalid staged upload references', async () => {
    const legacyPicture = `data:image/png;base64,${Buffer.from('legacy').toString('base64')}`;
    const legacyResponse = await account.upsertProfile(event({ profile_picture: legacyPicture }));
    expect(legacyResponse.statusCode).toBe(400);
    expect(JSON.parse(legacyResponse.body).error).toMatch(/no longer accepted/i);

    const invalidKeyResponse = await account.upsertProfile(event({
      profile_picture_upload_key: 'uploads/not-the-owner/profile_photo/avatar.png',
    }));
    expect(invalidKeyResponse.statusCode).toBe(400);
    expect(mockPromoteUpload).not.toHaveBeenCalled();
    expect(mockPutItem).not.toHaveBeenCalled();
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

  test('OAuth cancellation consumes state before returning the provider cancellation error', async () => {
    const state = 'google.cancel-state';

    const response = await account.upsertProfile(event({ action: 'oauthCancel', state }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/Google authorization was cancelled/i);
    expect(mockDocumentSend).toHaveBeenCalledTimes(1);
    expect(mockDocumentSend.mock.calls[0][0].input).toEqual(expect.objectContaining({
      UpdateExpression: 'REMOVE #oauth_state SET #updated_at = :updated_at',
      ConditionExpression: '#oauth_state.#state_hash = :state_hash AND #oauth_state.#expires_at >= :now',
      ReturnValues: 'ALL_OLD',
      ExpressionAttributeValues: expect.objectContaining({
        ':state_hash': createHash('sha256').update(`user-123\0${state}`).digest('hex'),
      }),
    }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
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

  test('links Discord to a Google-origin Cognito user without replacing the destination username', async () => {
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
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'Google_primary' },
        SourceUser: expect.objectContaining({ ProviderName: 'Discord', ProviderAttributeValue: 'discord-subject' }),
      }),
    }));
    expect(responseData(response).connections.google.connected).toBe(true);
    expect(responseData(response).connections.discord.connected).toBe(true);
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

  test('links Google to a Discord-origin Cognito user without replacing the destination username', async () => {
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
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'Discord_primary' },
        SourceUser: expect.objectContaining({ ProviderName: 'Google', ProviderAttributeValue: 'google-subject' }),
      }),
    }));
    expect(responseData(response).connections.google.connected).toBe(true);
    expect(responseData(response).connections.discord.connected).toBe(true);
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

  test('does not allow persisted primary Discord metadata to be disconnected with stale claims', async () => {
    mockGetItem.mockResolvedValue({
      ...existingProfile,
      oauth_connection_discord: {
        ...existingProfile.oauth_connection_discord,
        primary: true,
        status: 'active',
      },
    });

    const response = await account.upsertProfile(event({ action: 'disconnect', provider: 'discord' }));

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error).toMatch(/primary Discord sign-in/i);
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockDocumentSend).not.toHaveBeenCalled();
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
  ])('returns an actionable 409 and exactly clears the staged Google identity after Cognito %s', async (errorName) => {
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
    expect(JSON.parse(response.body).error).toMatch(/separate sign-in profile.*not automatically merged/i);
    expect(response.body).not.toContain('definitive link failure');
    const release = mockDocumentSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.ExpressionAttributeValues?.[':provider'] === 'google-definitive-failure');
    expect(release).toEqual(expect.objectContaining({
      UpdateExpression: 'REMOVE #connection SET #updated_at = :updated_at',
      ConditionExpression: '#connection.#status = :linking AND #connection.#generation = :generation AND #connection.#provider = :provider',
      ExpressionAttributeValues: {
        ':linking': 'linking',
        ':generation': 'generation-test',
        ':provider': 'google-definitive-failure',
        ':updated_at': '2026-08-18T10:00:00.000Z',
      },
    }));
  });

  test('sanitizes IAM AccessDenied during Google linking as a support-oriented 503', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'google-access-secret' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'google-access-denied',
          email: 'student@example.com',
          email_verified: true,
          name: 'Student Name',
        }),
      });
    mockCognitoSend.mockRejectedValueOnce(Object.assign(
      new Error('arn:aws:iam::123456789012:role/private is not authorized to link users'),
      { name: 'AccessDeniedException' },
    ));

    const response = await account.upsertProfile(event({
      action: 'oauthCallback', code: 'google-code', state: 'google.random-state',
    }));

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toBe(
      'Google account linking is temporarily unavailable. Please contact support.',
    );
    expect(response.body).not.toMatch(/arn:aws|123456789012|private/i);
    const release = mockDocumentSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.UpdateExpression === 'REMOVE #connection SET #updated_at = :updated_at');
    expect(release.ConditionExpression).toBe(
      '#connection.#status = :linking AND #connection.#generation = :generation AND #connection.#provider = :provider',
    );
    expect(release.ExpressionAttributeValues[':provider']).toBe('google-access-denied');
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
