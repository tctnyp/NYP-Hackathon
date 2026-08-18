const mockQueryItems = jest.fn();
const mockPutItem = jest.fn();

jest.mock('../src/utils/database', () => ({
  TASKS_TABLE: 'tasks-test',
  generateId: () => 'module-123',
  timestamp: () => '2026-08-18T15:00:00.000Z',
  getItem: jest.fn(),
  putItem: mockPutItem,
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  queryItems: mockQueryItems,
}));

const modules = require('../src/handlers/modules');

function event(body, sub = 'user-123') {
  return {
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: { sub } } },
  };
}

function bodyOf(response) {
  return JSON.parse(response.body);
}

describe('module creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryItems.mockResolvedValue([]);
    mockPutItem.mockResolvedValue();
  });

  test('normalizes, stores, and returns a new module', async () => {
    const response = await modules.createModule(event({
      module_code: ' cs101 ',
      module_name: ' Introduction to Computing ',
      color: '#3b82f6',
    }));

    expect(response.statusCode).toBe(201);
    expect(mockQueryItems).toHaveBeenCalledWith(expect.objectContaining({
      FilterExpression: 'module_code = :code',
      ExpressionAttributeValues: {
        ':pk': 'USER#user-123',
        ':sk': 'MODULE#',
        ':code': 'CS101',
      },
    }));
    expect(mockPutItem).toHaveBeenCalledWith('tasks-test', expect.objectContaining({
      PK: 'USER#user-123',
      SK: 'MODULE#module-123',
      module_id: 'module-123',
      module_code: 'CS101',
      module_name: 'Introduction to Computing',
      color: '#3b82f6',
    }));
    expect(bodyOf(response).data.module.module_code).toBe('CS101');
  });

  test('rejects duplicate normalized module codes without writing', async () => {
    mockQueryItems.mockResolvedValue([{ module_id: 'existing' }]);

    const response = await modules.createModule(event({
      module_code: ' cs101 ',
      module_name: 'Computing',
    }));

    expect(response.statusCode).toBe(409);
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  test('rejects whitespace-only module details before querying', async () => {
    const response = await modules.createModule(event({
      module_code: '   ',
      module_name: '   ',
    }));

    expect(response.statusCode).toBe(400);
    expect(mockQueryItems).not.toHaveBeenCalled();
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});
