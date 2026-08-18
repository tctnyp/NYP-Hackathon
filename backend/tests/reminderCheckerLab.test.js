const mockSesSend = jest.fn();
const mockGetItem = jest.fn();
const mockPutItem = jest.fn();
const mockScanPage = jest.fn();
const mockUpdateItem = jest.fn();

jest.mock('@aws-sdk/client-sesv2', () => {
  class SendEmailCommand { constructor(input) { this.input = input; } }
  return { SESv2Client: jest.fn(() => ({ send: mockSesSend })), SendEmailCommand };
}, { virtual: true });

jest.mock('../src/utils/database', () => ({
  getItem: mockGetItem,
  putItem: mockPutItem,
  scanPage: mockScanPage,
  updateItem: mockUpdateItem,
  TASKS_TABLE: 'tasks',
  USERS_TABLE: 'users',
  timestamp: jest.fn(() => '2026-08-18T12:00:00.000Z'),
}));

process.env.REMINDER_FROM_EMAIL = 'noreply@example.com';
process.env.APP_URL = 'https://app.example.com';
const reminderChecker = require('../src/handlers/reminderCheckerLab');

const reminder = {
  PK: 'REMINDER#2026-08-18#12',
  SK: 'TASK#t1#r1',
  reminder_id: 'r1',
  user_id: 'u1',
  task_id: 't1',
  message: 'Due soon',
};
const task = {
  PK: 'USER#u1',
  SK: 'TASK#t1',
  user_id: 'u1',
  task_id: 't1',
  title: 'Report',
  deadline: '2026-09-01T10:00:00.000Z',
  status: 'not_started',
};
const reminderNextKey = { PK: 'REMINDER#2026-08-18#13', SK: 'TASK#next#r-next' };
const taskNextKey = { PK: 'USER#next', SK: 'TASK#next' };
const reminderCursorKey = { PK: 'SYSTEM#REMINDER_CHECKER', SK: 'CURSOR#DUE_REMINDERS' };
const taskCursorKey = { PK: 'SYSTEM#REMINDER_CHECKER', SK: 'CURSOR#OVERDUE_TASKS' };

function responseBody(response) { return JSON.parse(response.body); }
function isSystemKey(key) { return key?.PK === 'SYSTEM#REMINDER_CHECKER'; }

function defaultGetItem(table, key) {
  if (table === 'tasks' && isSystemKey(key)) return undefined;
  if (table === 'tasks') return task;
  if (table === 'users') return { user_id: 'u1', email: 'student@example.com' };
  return undefined;
}

function cursorRecord(phase, scanCursor) {
  return {
    PK: 'SYSTEM#REMINDER_CHECKER',
    SK: phase === 'reminders' ? 'CURSOR#DUE_REMINDERS' : 'CURSOR#OVERDUE_TASKS',
    entity_type: 'SYSTEM',
    scan_cursor: scanCursor,
  };
}

describe('deployed reminder checker SES delivery and scan fairness', () => {
  let consoleError;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.REMINDER_FROM_EMAIL = 'noreply@example.com';
    mockGetItem.mockImplementation(defaultGetItem);
    mockScanPage
      .mockResolvedValueOnce({ Items: [reminder], LastEvaluatedKey: reminderNextKey })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: taskNextKey });
    mockSesSend.mockResolvedValue({ MessageId: 'accepted' });
    mockUpdateItem.mockResolvedValue({});
    mockPutItem.mockResolvedValue({});
  });

  afterEach(() => consoleError.mockRestore());

  test('uses one bounded page per phase and resumes both persisted cursors', async () => {
    const reminderStartKey = { PK: 'REMINDER#previous', SK: 'TASK#previous#r0' };
    const taskStartKey = { PK: 'USER#previous', SK: 'TASK#previous' };
    mockGetItem.mockImplementation((table, key) => {
      if (table === 'tasks' && key.SK === reminderCursorKey.SK) return cursorRecord('reminders', reminderStartKey);
      if (table === 'tasks' && key.SK === taskCursorKey.SK) return cursorRecord('tasks', taskStartKey);
      return defaultGetItem(table, key);
    });

    const response = await reminderChecker.handler();

    expect(response.statusCode).toBe(200);
    expect(mockScanPage).toHaveBeenCalledTimes(2);
    expect(mockScanPage.mock.calls[0][0]).toEqual(expect.objectContaining({
      Limit: 100,
      ExclusiveStartKey: reminderStartKey,
      FilterExpression: expect.stringContaining('entity_type = :type'),
    }));
    expect(mockScanPage.mock.calls[1][0]).toEqual(expect.objectContaining({
      Limit: 100,
      ExclusiveStartKey: taskStartKey,
      FilterExpression: expect.stringContaining('entity_type = :type'),
    }));
  });

  test('sends one direct SES email, then marks sent, and advances both cursors', async () => {
    const response = await reminderChecker.handler();

    expect(response.statusCode).toBe(200);
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const input = mockSesSend.mock.calls[0][0].input;
    expect(input.FromEmailAddress).toBe('noreply@example.com');
    expect(input.Destination.ToAddresses).toEqual(['student@example.com']);
    expect(input.Content.Simple.Body.Text.Data).toContain('https://app.example.com');
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'tasks',
      { PK: reminder.PK, SK: reminder.SK },
      { is_sent: true, sent_at: expect.any(String) },
    );
    expect(mockUpdateItem.mock.invocationCallOrder[0]).toBeGreaterThan(mockSesSend.mock.invocationCallOrder[0]);
    expect(mockPutItem).toHaveBeenNthCalledWith(1, 'tasks', {
      ...reminderCursorKey,
      entity_type: 'SYSTEM',
      cursor_phase: 'due_reminders',
      scan_cursor: reminderNextKey,
    });
    expect(mockPutItem).toHaveBeenNthCalledWith(2, 'tasks', {
      ...taskCursorKey,
      entity_type: 'SYSTEM',
      cursor_phase: 'overdue_tasks',
      scan_cursor: taskNextKey,
    });
    expect(response.body).not.toContain('student@example.com');
    expect(JSON.stringify(mockPutItem.mock.calls)).not.toContain('student@example.com');
  });

  test.each([
    ['missing task', null, 'task_missing'],
    ['completed task', { ...task, status: 'completed' }, 'task_completed'],
  ])('terminally marks %s and still advances the reminder cursor', async (_name, foundTask, reason) => {
    mockGetItem.mockImplementation((table, key) => {
      if (table === 'tasks' && isSystemKey(key)) return undefined;
      if (table === 'tasks') return foundTask;
      return { user_id: 'u1', email: 'student@example.com' };
    });

    const response = await reminderChecker.handler();

    expect(responseBody(response).results.skipped).toBe(1);
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(mockUpdateItem).toHaveBeenCalledWith('tasks', { PK: reminder.PK, SK: reminder.SK }, {
      is_sent: true,
      processed_at: '2026-08-18T12:00:00.000Z',
      delivery_status: 'skipped',
      skip_reason: reason,
    });
    expect(mockPutItem).toHaveBeenNthCalledWith(1, 'tasks', expect.objectContaining({ scan_cursor: reminderNextKey }));
  });

  test.each([
    ['missing profile', null, 'recipient_missing'],
    ['profile without email', { user_id: 'u1' }, 'recipient_missing'],
    ['profile with invalid email', { user_id: 'u1', email: 'not-an-email' }, 'recipient_invalid'],
  ])('terminally marks %s without recipient leakage', async (_name, profile, reason) => {
    mockGetItem.mockImplementation((table, key) => {
      if (table === 'tasks' && isSystemKey(key)) return undefined;
      if (table === 'tasks') return task;
      if (table === 'users') return profile;
      return undefined;
    });

    const response = await reminderChecker.handler();

    expect(responseBody(response).results.skipped).toBe(1);
    expect(mockSesSend).not.toHaveBeenCalled();
    expect(mockUpdateItem).toHaveBeenCalledWith('tasks', { PK: reminder.PK, SK: reminder.SK }, expect.objectContaining({
      is_sent: true,
      delivery_status: 'skipped',
      skip_reason: reason,
    }));
    expect(response.body).not.toContain('not-an-email');
    expect(JSON.stringify(mockPutItem.mock.calls)).not.toContain('not-an-email');
  });

  test('leaves a rejected SES reminder unsent but advances to a later page', async () => {
    mockSesSend.mockRejectedValue(Object.assign(
      new Error('student@example.com was rejected: secret'),
      { name: 'MessageRejected' },
    ));

    const response = await reminderChecker.handler();
    const body = responseBody(response);

    expect(body.results.failed).toBe(1);
    expect(body.results.errors).toEqual([{ reminder_id: 'r1', code: 'MessageRejected' }]);
    expect(response.body).not.toContain('student@example.com');
    expect(response.body).not.toContain('secret');
    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(mockPutItem).toHaveBeenNthCalledWith(1, 'tasks', expect.objectContaining({ scan_cursor: reminderNextKey }));
  });

  test('processes an eligible reminder returned from a later page', async () => {
    const laterStartKey = { PK: 'REMINDER#first-page', SK: 'TASK#first-page#r0' };
    const laterReminder = { ...reminder, PK: 'REMINDER#later-page', SK: 'TASK#t2#r2', reminder_id: 'r2' };
    mockGetItem.mockImplementation((table, key) => {
      if (table === 'tasks' && key.SK === reminderCursorKey.SK) return cursorRecord('reminders', laterStartKey);
      if (table === 'tasks' && key.SK === taskCursorKey.SK) return undefined;
      return defaultGetItem(table, key);
    });
    mockScanPage.mockReset()
      .mockResolvedValueOnce({ Items: [laterReminder], LastEvaluatedKey: null })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: null });

    const response = await reminderChecker.handler();

    expect(responseBody(response).results.sent).toBe(1);
    expect(mockScanPage.mock.calls[0][0].ExclusiveStartKey).toEqual(laterStartKey);
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'tasks',
      { PK: laterReminder.PK, SK: laterReminder.SK },
      { is_sent: true, sent_at: expect.any(String) },
    );
    expect(mockPutItem).toHaveBeenNthCalledWith(1, 'tasks', expect.objectContaining({ scan_cursor: null }));
  });

  test('updates overdue tasks from a bounded later page and advances its cursor', async () => {
    const overdue = { ...task, status: 'in_progress' };
    const taskStartKey = { PK: 'USER#earlier', SK: 'TASK#earlier' };
    mockGetItem.mockImplementation((table, key) => {
      if (table === 'tasks' && key.SK === reminderCursorKey.SK) return undefined;
      if (table === 'tasks' && key.SK === taskCursorKey.SK) return cursorRecord('tasks', taskStartKey);
      return defaultGetItem(table, key);
    });
    mockScanPage.mockReset()
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: null })
      .mockResolvedValueOnce({ Items: [overdue], LastEvaluatedKey: taskNextKey });

    const response = await reminderChecker.handler();

    expect(responseBody(response).results.overdue_updated).toBe(1);
    expect(mockScanPage.mock.calls[1][0]).toEqual(expect.objectContaining({ Limit: 100, ExclusiveStartKey: taskStartKey }));
    expect(mockUpdateItem).toHaveBeenCalledWith('tasks', { PK: task.PK, SK: task.SK }, expect.objectContaining({ status: 'overdue' }));
    expect(mockPutItem).toHaveBeenNthCalledWith(2, 'tasks', expect.objectContaining({ scan_cursor: taskNextKey }));
  });

  test('stores null at the end of a scan so the next schedule wraps to the first page', async () => {
    mockScanPage.mockReset()
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await reminderChecker.handler();

    expect(mockPutItem).toHaveBeenNthCalledWith(1, 'tasks', expect.objectContaining({ scan_cursor: null }));
    expect(mockPutItem).toHaveBeenNthCalledWith(2, 'tasks', expect.objectContaining({ scan_cursor: null }));
    expect(mockScanPage.mock.calls[0][0]).not.toHaveProperty('ExclusiveStartKey');
    expect(mockScanPage.mock.calls[1][0]).not.toHaveProperty('ExclusiveStartKey');
  });

  test('fails the invocation when cursor persistence fails', async () => {
    mockPutItem.mockRejectedValueOnce(new Error('private DynamoDB details'));

    await expect(reminderChecker.handler()).rejects.toThrow('Reminder scan cursor persistence failed');
    expect(mockScanPage).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Reminder check failed', { code: 'DeliveryFailed' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private DynamoDB details');
  });

  test('bounds sanitized result errors while preserving cursor progress', async () => {
    const reminders = Array.from({ length: 30 }, (_, i) => ({
      ...reminder,
      reminder_id: `r${i}`,
      task_id: `t${i}`,
      SK: `TASK#t${i}#r${i}`,
    }));
    mockScanPage.mockReset()
      .mockResolvedValueOnce({ Items: reminders, LastEvaluatedKey: reminderNextKey })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: null });
    mockSesSend.mockRejectedValue(new Error('private service details'));

    const body = responseBody(await reminderChecker.handler());

    expect(body.results.failed).toBe(30);
    expect(body.results.errors).toHaveLength(20);
    expect(body.results.errors.every((item) => item.code === 'DeliveryFailed')).toBe(true);
    expect(mockPutItem).toHaveBeenNthCalledWith(1, 'tasks', expect.objectContaining({ scan_cursor: reminderNextKey }));
  });

  test('rejects a top-level scan failure for scheduled retry without leaking details', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('private DynamoDB table and request details'));

    await expect(reminderChecker.handler()).rejects.toMatchObject({
      name: 'ReminderCheckError',
      message: 'Reminder check failed',
    });
    expect(consoleError).toHaveBeenCalledWith('Reminder check failed', { code: 'DeliveryFailed' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private DynamoDB table and request details');
  });
});
