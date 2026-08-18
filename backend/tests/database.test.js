const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class Command {
    constructor(input) { this.input = input; }
  }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: Command,
    PutCommand: Command,
    UpdateCommand: Command,
    DeleteCommand: Command,
    QueryCommand: Command,
    ScanCommand: Command,
    TransactWriteCommand: Command,
    BatchWriteCommand: Command,
  };
});

const database = require('../src/utils/database');

describe('database utility hardening', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getItem uses strongly consistent reads by default', async () => {
    mockSend.mockResolvedValueOnce({ Item: { id: 'one' } });
    await expect(database.getItem('table', { id: 'one' })).resolves.toEqual({ id: 'one' });
    expect(mockSend.mock.calls[0][0].input).toEqual({ TableName: 'table', Key: { id: 'one' }, ConsistentRead: true });
  });

  test('queryTable follows every LastEvaluatedKey', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 1 }], LastEvaluatedKey: { PK: 'next' } })
      .mockResolvedValueOnce({ Items: [{ id: 2 }] });
    const items = await database.queryTable('table', { KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'x' } });
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'next' });
  });

  test('queryTable honors an overall Limit across pages', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 1 }], LastEvaluatedKey: { PK: 'next' } })
      .mockResolvedValueOnce({ Items: [{ id: 2 }, { id: 3 }] });
    const items = await database.queryTable('table', { KeyConditionExpression: 'PK = :pk', Limit: 2 });
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockSend.mock.calls[1][0].input.Limit).toBe(1);
  });

  test('scanTable follows pagination', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ id: 1 }], LastEvaluatedKey: { id: 'next' } })
      .mockResolvedValueOnce({ Items: [{ id: 2 }] });
    await expect(database.scanTable('table', {})).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('batchWriteTable chunks requests and retries unprocessed items', async () => {
    const requests = Array.from({ length: 26 }, (_, id) => ({ DeleteRequest: { Key: { id } } }));
    mockSend
      .mockResolvedValueOnce({ UnprocessedItems: { table: [requests[0]] } })
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({ UnprocessedItems: {} });
    await database.batchWriteTable('table', requests);
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[0][0].input.RequestItems.table).toHaveLength(25);
    expect(mockSend.mock.calls[1][0].input.RequestItems.table).toHaveLength(1);
    expect(mockSend.mock.calls[2][0].input.RequestItems.table).toHaveLength(1);
  });
});
