const mockSyncTask = jest.fn();
const mockDeleteTask = jest.fn();
const mockScan = jest.fn();
const mockCommitCursor = jest.fn();
const mockReconcile = jest.fn();
const mockFinishDisable = jest.fn();
const mockRevoke = jest.fn();

jest.mock('../src/utils/googleCalendarSync', () => {
  class CalendarSyncError extends Error {
    constructor(message, options = {}) {
      super(message);
      Object.assign(this, options);
    }
  }
  return {
    CalendarSyncError,
    commitConnectionScanCursor: mockCommitCursor,
    deleteTaskForUser: mockDeleteTask,
    finishDisable: mockFinishDisable,
    reconcileUserCalendar: mockReconcile,
    revokeRefreshTokenIfConfigured: mockRevoke,
    scanConnections: mockScan,
    syncTaskForUser: mockSyncTask,
  };
});

const worker = require('../src/handlers/googleCalendarWorker');

function image(taskId, status = 'in_progress') {
  return {
    entity_type: { S: 'TASK' },
    user_id: { S: 'user-123' },
    task_id: { S: taskId },
    title: { S: 'Task' },
    status: { S: status },
    deadline: { S: '2026-09-01T10:00:00.000Z' },
    progress_percentage: { N: '20' },
  };
}

describe('Google Calendar synchronization worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncTask.mockResolvedValue({ synced: true });
    mockDeleteTask.mockResolvedValue({ synced: true });
    mockScan.mockResolvedValue({ items: [], nextCursor: null });
    mockCommitCursor.mockResolvedValue();
    mockReconcile.mockResolvedValue({ synced: true, complete: true });
    mockFinishDisable.mockResolvedValue();
    mockRevoke.mockResolvedValue(false);
  });

  test('synchronizes inserted and modified tasks from DynamoDB stream images', async () => {
    const response = await worker.handler({ Records: [{
      eventID: '1',
      eventName: 'MODIFY',
      dynamodb: { SequenceNumber: 'seq-1', NewImage: image('task-1') },
    }] });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(mockSyncTask).toHaveBeenCalledWith('user-123', expect.objectContaining({
      task_id: 'task-1', progress_percentage: 20,
    }));
  });

  test('deletes the owned event when a task is removed', async () => {
    await worker.handler({ Records: [{
      eventID: '2',
      eventName: 'REMOVE',
      dynamodb: { SequenceNumber: 'seq-2', OldImage: image('task-2') },
    }] });
    expect(mockDeleteTask).toHaveBeenCalledWith('user-123', 'task-2');
    expect(mockSyncTask).not.toHaveBeenCalled();
  });

  test('returns retryable records as partial batch failures', async () => {
    const { CalendarSyncError } = require('../src/utils/googleCalendarSync');
    mockSyncTask.mockRejectedValue(new CalendarSyncError('temporary', { retryable: true }));
    const response = await worker.handler({ Records: [{
      eventID: 'retry-me',
      eventName: 'INSERT',
      dynamodb: { SequenceNumber: 'seq-retry', NewImage: image('task-3') },
    }] });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'seq-retry' }] });
  });


  test('returns permanent ownership conflicts as partial failures for terminal queue delivery', async () => {
    const { CalendarSyncError } = require('../src/utils/googleCalendarSync');
    mockSyncTask.mockRejectedValue(new CalendarSyncError('ownership conflict', {
      code: 'event_ownership_conflict',
      retryable: false,
    }));
    const response = await worker.handler({ Records: [{
      eventID: 'permanent-failure',
      eventName: 'INSERT',
      dynamodb: { SequenceNumber: 'seq-permanent', NewImage: image('task-4') },
    }] });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'seq-permanent' }] });
  });

  test('rejects a failed stream record without the required sequence number', async () => {
    mockSyncTask.mockRejectedValue(new Error('unexpected failure'));
    await expect(worker.handler({ Records: [{
      eventID: 'missing-sequence',
      eventName: 'INSERT',
      dynamodb: { NewImage: image('task-5') },
    }] })).rejects.toThrow('DynamoDB stream sequence number is missing');
  });

  test('isolates a user failure, advances the cursor, and processes a later user next cycle', async () => {
    const { CalendarSyncError } = require('../src/utils/googleCalendarSync');
    mockScan
      .mockResolvedValueOnce({
        items: [{ user_id: 'user-failure', status: 'enabled' }],
        nextCursor: { user_id: 'user-failure' },
      })
      .mockResolvedValueOnce({
        items: [{ user_id: 'user-later', status: 'enabled' }],
        nextCursor: { user_id: 'user-later' },
      });
    mockReconcile
      .mockRejectedValueOnce(new CalendarSyncError('provider unavailable', {
        code: 'provider_temporarily_unavailable', retryable: true,
      }))
      .mockResolvedValueOnce({ synced: true, complete: true });

    await expect(worker.handler({ source: 'aws.events' })).resolves.toEqual({
      statusCode: 200, body: JSON.stringify({ processed: 1 }),
    });
    await expect(worker.handler({ source: 'aws.events' })).resolves.toEqual({
      statusCode: 200, body: JSON.stringify({ processed: 1 }),
    });
    expect(mockReconcile).toHaveBeenNthCalledWith(1, 'user-failure', { limit: 1 });
    expect(mockReconcile).toHaveBeenNthCalledWith(2, 'user-later', { limit: 1 });
    expect(mockCommitCursor).toHaveBeenNthCalledWith(1, { user_id: 'user-failure' });
    expect(mockCommitCursor).toHaveBeenNthCalledWith(2, { user_id: 'user-later' });
  });


  test('scheduled reconciliation retries pending disable cleanup', async () => {
    mockScan.mockResolvedValue({
      items: [{ user_id: 'user-123', status: 'disable_pending' }],
      nextCursor: { user_id: 'user-123' },
    });
    const response = await worker.handler({ source: 'aws.events' });
    expect(mockScan).toHaveBeenCalledWith(25);
    expect(mockReconcile).toHaveBeenCalledWith('user-123', { removeAll: true, limit: 1 });
    expect(mockRevoke).toHaveBeenCalledWith('user-123');
    expect(mockFinishDisable).toHaveBeenCalledWith('user-123');
    expect(mockCommitCursor).toHaveBeenCalledWith({ user_id: 'user-123' });
    expect(mockCommitCursor.mock.invocationCallOrder[0]).toBeGreaterThan(mockReconcile.mock.invocationCallOrder[0]);
    expect(response.statusCode).toBe(200);
  });
});
