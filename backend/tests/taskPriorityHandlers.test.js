const mockPutItem = jest.fn();
const mockBatchWrite = jest.fn();
const mockGetItem = jest.fn();
const mockUpdateItem = jest.fn();

jest.mock('../src/utils/database', () => ({
  TASKS_TABLE: 'tasks-test',
  generateId: () => 'task-123',
  timestamp: () => '2026-08-19T00:00:00.000Z',
  putItem: mockPutItem,
  batchWrite: mockBatchWrite,
  getItem: mockGetItem,
  updateItem: mockUpdateItem,
}));

const createTask = require('../src/handlers/createTask');
const updateTask = require('../src/handlers/updateTask');

function event(body, taskId) {
  return {
    body: JSON.stringify(body),
    pathParameters: taskId ? { taskId } : undefined,
    requestContext: { authorizer: { claims: { sub: 'user-123' } } },
  };
}

function responseBody(response) {
  return JSON.parse(response.body);
}

const baseTask = {
  title: 'Priority migration',
  task_type: 'assignment',
  deadline: '2026-09-01T12:00:00.000Z',
};

describe('task priority handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPutItem.mockResolvedValue();
    mockBatchWrite.mockResolvedValue();
  });

  test('creates tasks with a canonical priority and no difficulty field', async () => {
    const response = await createTask.handler(event({ ...baseTask, priority: 'important' }));

    expect(response.statusCode).toBe(201);
    const storedTask = mockPutItem.mock.calls[0][1];
    expect(storedTask.priority).toBe('important');
    expect(storedTask).not.toHaveProperty('difficulty');
    expect(responseBody(response).data.task.priority).toBe('important');
  });

  test('maps a legacy difficulty request to the new priority field', async () => {
    const response = await createTask.handler(event({ ...baseTask, difficulty: 'hard' }));

    expect(response.statusCode).toBe(201);
    expect(mockPutItem.mock.calls[0][1]).toEqual(expect.objectContaining({ priority: 'high' }));
  });

  test('rejects values outside the five priority levels', async () => {
    const response = await createTask.handler(event({ ...baseTask, priority: 'easy' }));

    expect(response.statusCode).toBe(400);
    expect(responseBody(response).error).toMatch(/Invalid priority/);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  test('migrates a legacy stored difficulty during an unrelated update', async () => {
    mockGetItem.mockResolvedValue({
      ...baseTask,
      task_id: 'task-123',
      user_id: 'user-123',
      status: 'not_started',
      difficulty: 'hard',
    });
    mockUpdateItem.mockImplementation(async (_table, _key, updates) => ({
      ...baseTask,
      task_id: 'task-123',
      user_id: 'user-123',
      difficulty: 'hard',
      ...updates,
    }));

    const response = await updateTask.handler(event({ title: 'Updated title' }, 'task-123'));

    expect(response.statusCode).toBe(200);
    const updates = mockUpdateItem.mock.calls[0][2];
    expect(updates.priority).toBe('high');
    const returnedTask = responseBody(response).data.task;
    expect(returnedTask.priority).toBe('high');
    expect(returnedTask).not.toHaveProperty('difficulty');
  });

  test('accepts legacy difficulty on update but persists only priority', async () => {
    mockGetItem.mockResolvedValue({ ...baseTask, task_id: 'task-123', status: 'not_started', priority: 'low' });
    mockUpdateItem.mockImplementation(async (_table, _key, updates) => ({ ...baseTask, ...updates }));

    const response = await updateTask.handler(event({ difficulty: 'very_hard' }, 'task-123'));

    expect(response.statusCode).toBe(200);
    expect(mockUpdateItem.mock.calls[0][2].priority).toBe('urgent');
    expect(responseBody(response).data.task.priority).toBe('urgent');
  });
});
