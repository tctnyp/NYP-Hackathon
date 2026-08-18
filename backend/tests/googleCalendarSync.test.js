const mockSend = jest.fn();

jest.mock('../src/utils/database', () => ({
  docClient: { send: mockSend },
  TASKS_TABLE: 'tasks-test',
  USERS_TABLE: 'users-test',
}));

process.env.CALENDAR_CONNECTIONS_TABLE = 'calendar-test';
process.env.GOOGLE_CALENDAR_SYNC_ENABLED = 'true';
process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID = 'calendar-client';
process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET = 'calendar-secret';
process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI = 'https://app.example/account/settings';
process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
process.env.ENVIRONMENT = 'test';

const sync = require('../src/utils/googleCalendarSync');

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === null ? '' : JSON.stringify(data)),
  };
}

const task = {
  task_id: '1700000000000-abc123xyz',
  user_id: 'user-123',
  entity_type: 'TASK',
  title: 'Secure systems assignment',
  description: 'Finish the threat model',
  task_type: 'assignment',
  difficulty: 'hard',
  progress_percentage: 25,
  estimated_hours: 2,
  deadline: '2026-09-01T10:00:00.000Z',
  status: 'in_progress',
};

describe('Google Calendar synchronization utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('encrypts refresh credentials with user-bound AES-256-GCM and rejects tampering', () => {
    const encrypted = sync.encryptRefreshToken('refresh-secret', 'user-123');
    expect(encrypted).toEqual(expect.objectContaining({ version: 'v1', algorithm: 'A256GCM' }));
    expect(JSON.stringify(encrypted)).not.toContain('refresh-secret');
    expect(sync.decryptRefreshToken(encrypted, 'user-123')).toBe('refresh-secret');
    expect(() => sync.decryptRefreshToken(encrypted, 'other-user')).toThrow(/could not be decrypted/i);

    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` };
    expect(() => sync.decryptRefreshToken(tampered, 'user-123')).toThrow(/could not be decrypted/i);
  });

  test('requires an exact random 32-byte base64 key', () => {
    expect(sync.isCalendarConfigured({ requireEncryption: true })).toBe(true);
    const original = process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY_BASE64;
    process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY_BASE64 = Buffer.alloc(31).toString('base64');
    expect(sync.isCalendarConfigured({ requireEncryption: true })).toBe(false);
    process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY_BASE64 = original;
  });

  test('derives stable Google-compatible event IDs and private ownership markers', () => {
    const first = sync.googleEventId('user-123', task.task_id, 'prod');
    const second = sync.googleEventId('user-123', task.task_id, 'prod');
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(first).not.toContain(task.task_id);

    const event = sync.googleEvent(task, 'user-123');
    expect(event.id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(event.start.dateTime).toBe('2026-09-01T08:00:00.000Z');
    expect(event.end.dateTime).toBe(task.deadline);
    expect(sync.isOwnedEvent(event, 'user-123', task.task_id)).toBe(true);
    expect(sync.isOwnedEvent(event, 'other-user', task.task_id)).toBe(false);
  });

  test('paginates all user tasks for full reconciliation', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [task], LastEvaluatedKey: { PK: 'next', SK: 'next' } })
      .mockResolvedValueOnce({ Items: [{ ...task, task_id: 'task-2' }] });

    const tasks = await sync.queryAllTasks('user-123');
    expect(tasks.map((item) => item.task_id)).toEqual([task.task_id, 'task-2']);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'next', SK: 'next' });
  });

  test('updates only an existing event carrying the expected private marker after insert conflict', async () => {
    const expected = sync.googleEvent(task, 'user-123');
    global.fetch
      .mockResolvedValueOnce(jsonResponse(409, { error: { code: 409 } }))
      .mockResolvedValueOnce(jsonResponse(200, expected))
      .mockResolvedValueOnce(jsonResponse(200, expected));

    await expect(sync.upsertTaskEvent('access-token', task, 'user-123')).resolves.toEqual(expected);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[2][1].method).toBe('PUT');
  });

  test('checkpoints bounded task reconciliation instead of processing an unbounded calendar', async () => {
    const encrypted = sync.encryptRefreshToken('refresh-secret', 'user-123');
    mockSend
      .mockResolvedValueOnce({ Item: {
        user_id: 'user-123', status: 'enabled', enabled: true, encrypted_refresh_token: encrypted,
      } })
      .mockResolvedValueOnce({ Items: [task], LastEvaluatedKey: { PK: 'next', SK: 'next' } })
      .mockResolvedValueOnce({ Attributes: {} });
    global.fetch
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'access-token' }))
      .mockResolvedValueOnce(jsonResponse(200, sync.googleEvent(task, 'user-123')));

    const result = await sync.reconcileUserCalendar('user-123', { limit: 1 });
    expect(result).toEqual(expect.objectContaining({ pending: true, complete: false, processed: 1 }));
    const query = mockSend.mock.calls[1][0].input;
    expect(query.Limit).toBe(1);
    const checkpointUpdate = mockSend.mock.calls[2][0].input;
    expect(checkpointUpdate.ExpressionAttributeValues).toEqual(expect.objectContaining({
      ':value0': { phase: 'tasks', task_cursor: { PK: 'next', SK: 'next' } },
    }));
  });

  test('preserves a cleanup tombstone when Google authorization is lost during disable', async () => {
    const encrypted = sync.encryptRefreshToken('refresh-secret', 'user-123');
    mockSend
      .mockResolvedValueOnce({ Item: {
        user_id: 'user-123', status: 'disable_pending', enabled: false, encrypted_refresh_token: encrypted,
      } })
      .mockResolvedValueOnce({ Attributes: {} });
    global.fetch.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));

    await expect(sync.reconcileUserCalendar('user-123', { removeAll: true, limit: 1 })).rejects.toMatchObject({
      code: 'reauthorization_required',
    });
    const update = mockSend.mock.calls[1][0].input;
    expect(update.ExpressionAttributeValues).toEqual(expect.objectContaining({
      ':value0': 'cleanup_reauthorization_required',
      ':value2': 'cleanup_reauthorization_required',
    }));
    expect(update.UpdateExpression).toContain('REMOVE');
    expect(Object.values(update.ExpressionAttributeNames)).toContain('encrypted_refresh_token');
  });

  test('refuses to overwrite an unowned event on deterministic-ID collision', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(409, { error: { code: 409 } }))
      .mockResolvedValueOnce(jsonResponse(200, {
        id: sync.googleEventId('user-123', task.task_id),
        extendedProperties: { private: { app: 'another-app' } },
      }));

    await expect(sync.upsertTaskEvent('access-token', task, 'user-123')).rejects.toMatchObject({
      code: 'event_ownership_conflict',
      status: 409,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
