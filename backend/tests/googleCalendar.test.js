const { createHash } = require('node:crypto');

const mockSend = jest.fn();
const mockGetConnection = jest.fn();
const mockGetGoogleLinkProfile = jest.fn();
const mockSetConnectionStatus = jest.fn();
const mockReconcile = jest.fn();
const mockFinishDisable = jest.fn();
const mockRevoke = jest.fn();
const mockEncrypt = jest.fn();

jest.mock('../src/utils/database', () => ({
  docClient: { send: mockSend },
  USERS_TABLE: 'users-test',
  timestamp: () => '2026-08-18T10:00:00.000Z',
}));

jest.mock('../src/utils/googleCalendarSync', () => {
  class CalendarSyncError extends Error {}
  return {
    CALENDAR_CONNECTIONS_TABLE: 'calendar-test',
    CALENDAR_SCOPE: 'https://www.googleapis.com/auth/calendar.events',
    CalendarSyncError,
    calendarConfig: () => ({
      clientId: 'calendar-client',
      clientSecret: 'calendar-secret',
      redirectUri: 'https://app.example/account/settings',
    }),
    encryptRefreshToken: mockEncrypt,
    finishDisable: mockFinishDisable,
    getConnection: mockGetConnection,
    getGoogleLinkProfile: mockGetGoogleLinkProfile,
    isCalendarConfigured: () => true,
    reconcileUserCalendar: mockReconcile,
    revokeRefreshTokenIfConfigured: mockRevoke,
    setConnectionStatus: mockSetConnectionStatus,
  };
});

const calendar = require('../src/handlers/googleCalendar');

function event(body, claims = {}) {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          email: 'student@example.com',
          auth_time: Math.floor(Date.now() / 1000),
          'cognito:username': 'student',
          ...claims,
        },
      },
    },
  };
}

function responseData(response) {
  return JSON.parse(response.body).data;
}

function jsonResponse(data, ok = true) {
  return { ok, json: async () => data };
}

function consumedState(mode = 'enable') {
  return {
    Attributes: {
      oauth_state: {
        purpose: 'calendar',
        provider_user_id: 'google-subject',
        primary: false,
        link_guard_field: 'link_version',
        link_guard_value: 'link-version-1',
        mode,
      },
    },
  };
}

describe('Google Calendar consent handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGoogleLinkProfile.mockResolvedValue({
      user_id: 'user-123',
      oauth_connection_google: {
        provider_user_id: 'google-subject',
        email: 'student@example.com',
        link_version: 'link-version-1',
        status: 'active',
      },
    });
    mockGetConnection.mockResolvedValue(null);
    mockSetConnectionStatus.mockResolvedValue({ status: 'enabled', enabled: true });
    mockReconcile.mockResolvedValue({ synced: true });
    mockFinishDisable.mockResolvedValue();
    mockRevoke.mockResolvedValue(false);
    mockEncrypt.mockReturnValue({ version: 'v1', ciphertext: 'encrypted-only' });
    mockSend.mockResolvedValue({});
    global.fetch = jest.fn();
  });

  afterAll(() => { delete global.fetch; });

  test('requires recent authentication before creating consent state', async () => {
    const response = await calendar.update(event({ action: 'authorize' }, {
      auth_time: Math.floor(Date.now() / 1000) - 3600,
    }));
    expect(response.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('offers Calendar consent only when Google is linked', async () => {
    mockGetGoogleLinkProfile.mockResolvedValue({ user_id: 'user-123' });
    const response = await calendar.update(event({ action: 'authorize' }));
    expect(response.statusCode).toBe(409);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('stores only a purpose-bound state hash and requests exact offline Calendar consent', async () => {
    const response = await calendar.update(event({ action: 'authorize' }));
    const data = responseData(response);
    const url = new URL(data.authorization_url);
    const state = url.searchParams.get('state');
    const input = mockSend.mock.calls[0][0].input;
    const storedState = input.ExpressionAttributeValues[':oauth_state'];

    expect(response.statusCode).toBe(200);
    expect(state).toMatch(/^calendar\.[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toContain('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(storedState.purpose).toBe('calendar');
    expect(storedState.state_hash).toBe(
      createHash('sha256').update(`user-123\0calendar\0${state}`).digest('hex'),
    );
    expect(JSON.stringify(input)).not.toContain(state);
  });

  test('consumes state once, verifies linked Google subject, and never persists plaintext tokens', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        scope: 'openid email https://www.googleapis.com/auth/calendar.events',
      }))
      .mockResolvedValueOnce(jsonResponse({
        sub: 'google-subject',
        email: 'student@example.com',
        email_verified: true,
      }));

    mockSend
      .mockResolvedValueOnce({
        Attributes: {
          oauth_state: {
            purpose: 'calendar',
            provider_user_id: 'google-subject',
            primary: false,
            link_guard_field: 'link_version',
            link_guard_value: 'link-version-1',
            mode: 'enable',
          },
        },
      })
      .mockResolvedValueOnce({});

    const response = await calendar.update(event({
      action: 'callback',
      code: 'authorization-code',
      state: `calendar.${'a'.repeat(43)}`,
    }));

    expect(response.statusCode).toBe(202);
    expect(mockSend.mock.calls[0][0].input.ConditionExpression).toContain('#oauth_state.#purpose');
    expect(mockEncrypt).toHaveBeenCalledWith('refresh-secret', 'user-123');
    const transaction = mockSend.mock.calls[1][0].input;
    expect(transaction.TransactItems[0].ConditionCheck).toEqual(expect.objectContaining({
      TableName: 'users-test',
      ConditionExpression: expect.stringContaining('#connection.#guard = :guard'),
    }));
    expect(transaction.TransactItems[1].Update.ExpressionAttributeValues).toEqual(expect.objectContaining({
      ':provider': 'google-subject',
      ':credential': { version: 'v1', ciphertext: 'encrypted-only' },
    }));
    expect(JSON.stringify(transaction)).not.toContain('access-secret');
    expect(JSON.stringify(response)).not.toContain('refresh-secret');
  });

  test('rejects consent from a different Google subject without storing credentials', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        scope: 'https://www.googleapis.com/auth/calendar.events openid email',
      }))
      .mockResolvedValueOnce(jsonResponse({
        sub: 'different-subject',
        email: 'student@example.com',
        email_verified: true,
      }));
    mockSend.mockResolvedValueOnce(consumedState());

    const response = await calendar.update(event({
      action: 'callback', code: 'code', state: `calendar.${'b'.repeat(43)}`,
    }));
    expect(response.statusCode).toBe(409);
    expect(mockSetConnectionStatus).not.toHaveBeenCalled();
  });

  test('rejects a replayed or expired Calendar state before provider calls', async () => {
    const conditionalError = new Error('condition');
    conditionalError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(conditionalError);
    const response = await calendar.update(event({
      action: 'callback', code: 'code', state: `calendar.${'r'.repeat(43)}`,
    }));
    expect(response.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects callback when unlink marked the Google connection inactive after consent began', async () => {
    mockSend.mockResolvedValueOnce(consumedState());
    mockGetGoogleLinkProfile.mockResolvedValue({
      user_id: 'user-123',
      oauth_connection_google: {
        provider_user_id: 'google-subject',
        link_version: 'link-version-1',
        status: 'unlinking',
      },
    });
    const response = await calendar.update(event({
      action: 'callback', code: 'code', state: `calendar.${'u'.repeat(43)}`,
    }));
    expect(response.statusCode).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  test('rejects missing Calendar scope or offline refresh credentials', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({
      access_token: 'access-secret', refresh_token: 'refresh-secret', scope: 'openid email',
    }));
    mockSend.mockResolvedValueOnce(consumedState());
    const noScope = await calendar.update(event({
      action: 'callback', code: 'code', state: `calendar.${'c'.repeat(43)}`,
    }));
    expect(noScope.statusCode).toBe(400);
    expect(mockSetConnectionStatus).not.toHaveBeenCalled();
  });

  test('queues manual synchronization without provider calls in the API request', async () => {
    mockGetConnection.mockResolvedValue({
      user_id: 'user-123', status: 'enabled', enabled: true, encrypted_refresh_token: { ciphertext: 'encrypted' },
    });
    const response = await calendar.update(event({ action: 'sync' }));
    expect(response.statusCode).toBe(202);
    expect(mockSetConnectionStatus).toHaveBeenCalledWith('user-123', {
      reconcile: { phase: 'tasks', task_cursor: null },
      last_error: null,
    });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('queues disable cleanup without provider calls in the API request', async () => {
    mockGetConnection.mockResolvedValue({
      user_id: 'user-123', status: 'enabled', enabled: true, encrypted_refresh_token: { ciphertext: 'encrypted' },
    });
    const response = await calendar.update(event({ action: 'disable' }));
    expect(response.statusCode).toBe(202);
    expect(mockSetConnectionStatus).toHaveBeenCalledWith('user-123', {
      status: 'disable_pending', enabled: false, last_error: null,
    });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
