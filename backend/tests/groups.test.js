const mockGetItem = jest.fn();
const mockQueryTable = jest.fn();
const mockScanTable = jest.fn();
const mockTransactWrite = jest.fn();
const mockBatchWriteTable = jest.fn();

jest.mock('../src/utils/database', () => ({
  GROUPS_TABLE: 'groups-test',
  USERS_TABLE: 'users-test',
  getItem: mockGetItem,
  queryTable: mockQueryTable,
  scanTable: mockScanTable,
  transactWrite: mockTransactWrite,
  batchWriteTable: mockBatchWriteTable,
  generateId: () => 'generated-id',
  timestamp: () => '2026-08-18T12:00:00.000Z',
}));

const groups = require('../src/handlers/groups');

function event({ method = 'GET', resource = '/groups', body, path = {}, claims = {} } = {}) {
  return {
    httpMethod: method,
    resource,
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: path,
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-1',
          email: 'owner@example.com',
          name: 'Owner Student',
          'cognito:username': 'owner',
          ...claims,
        },
      },
    },
  };
}

function payload(response) {
  return JSON.parse(response.body);
}

function data(response) {
  return payload(response).data;
}

const ownerMembership = {
  PK: 'GROUP#group-1',
  SK: 'MEMBER#user-1',
  entity_type: 'GROUP_MEMBER',
  group_id: 'group-1',
  group_name: 'Study Circle',
  group_description: 'Prepare together',
  group_color: '#2563eb',
  owner_id: 'user-1',
  user_id: 'user-1',
  display_name: 'Owner Student',
  email: 'owner@example.com',
  role: 'owner',
  joined_at: '2026-08-18T10:00:00.000Z',
};

const memberMembership = {
  ...ownerMembership,
  SK: 'MEMBER#user-2',
  user_id: 'user-2',
  display_name: 'Group Member',
  email: 'member@example.com',
  role: 'member',
};

const groupRecord = {
  PK: 'GROUP#group-1',
  SK: 'GROUP',
  entity_type: 'GROUP',
  group_id: 'group-1',
  name: 'Study Circle',
  description: 'Prepare together',
  color: '#2563eb',
  owner_id: 'user-1',
  created_at: '2026-08-18T10:00:00.000Z',
  updated_at: '2026-08-18T10:00:00.000Z',
};

const invitation = {
  PK: 'GROUP#group-1',
  SK: 'INVITE#hashed-email',
  entity_type: 'GROUP_INVITE',
  GSI1PK: 'USER#user-2',
  GSI1SK: 'INVITE#2026-08-18T11:00:00.000Z#group-1',
  group_id: 'group-1',
  group_name: 'Study Circle',
  group_description: 'Prepare together',
  group_color: '#2563eb',
  owner_id: 'user-1',
  target_user_id: 'user-2',
  target_display_name: 'Group Member',
  invited_by: 'user-1',
  invited_by_name: 'Owner Student',
  created_at: '2026-08-18T11:00:00.000Z',
};

const taskRecord = {
  PK: 'GROUP#group-1',
  SK: 'TASK#task-1',
  entity_type: 'GROUP_TASK',
  task_id: 'task-1',
  group_id: 'group-1',
  title: 'Draft report',
  description: '',
  deadline: '2026-08-20T10:00:00.000Z',
  status: 'completed',
  progress_percentage: 100,
  assigned_to: 'user-2',
  created_by: 'user-1',
  created_by_name: 'Owner Student',
  created_at: '2026-08-18T10:00:00.000Z',
  updated_at: '2026-08-18T10:00:00.000Z',
};

describe('groups collaboration handler', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryTable.mockReset();
    mockScanTable.mockReset();
    mockTransactWrite.mockReset();
    mockBatchWriteTable.mockReset();
    mockTransactWrite.mockResolvedValue(undefined);
    mockBatchWriteTable.mockResolvedValue(undefined);
    mockScanTable.mockResolvedValue([]);
  });

  test('creates a group and owner membership atomically with validated snapshots', async () => {
    mockQueryTable.mockResolvedValueOnce([]);
    const response = await groups.createGroup(event({ method: 'POST', body: { name: ' Study Circle ', description: ' Prepare together ', color: '#7c3aed' } }));

    expect(response.statusCode).toBe(201);
    expect(data(response).group).toEqual(expect.objectContaining({ group_id: 'generated-id', name: 'Study Circle', role: 'owner' }));
    expect(mockTransactWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ Update: expect.objectContaining({ Key: { PK: 'USER#user-1', SK: 'OWNED_GROUPS' }, ConditionExpression: expect.stringContaining('owned_count < :max') }) }),
      expect.objectContaining({ Put: expect.objectContaining({ Item: expect.objectContaining({ entity_type: 'GROUP', owner_id: 'user-1', people_count: 1, task_count: 0 }), ConditionExpression: 'attribute_not_exists(PK)' }) }),
      expect.objectContaining({ Put: expect.objectContaining({ Item: expect.objectContaining({ entity_type: 'GROUP_MEMBER', role: 'owner', GSI1PK: 'USER#user-1' }) }) }),
    ]));
  });

  test('rejects oversized group input before writing', async () => {
    const response = await groups.createGroup(event({ method: 'POST', body: { name: 'x'.repeat(81) } }));
    expect(response.statusCode).toBe(400);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('lists memberships and recipient invitations from only the authenticated user index', async () => {
    mockQueryTable.mockResolvedValueOnce([ownerMembership, invitation]);
    const response = await groups.listGroups(event());

    expect(response.statusCode).toBe(200);
    expect(data(response).groups).toEqual([expect.objectContaining({ group_id: 'group-1', role: 'owner' })]);
    expect(data(response).invitations).toEqual([expect.objectContaining({ group_id: 'group-1', invited_by_name: 'Owner Student' })]);
    expect(data(response).invitations[0]).not.toHaveProperty('target_user_id');
    expect(mockQueryTable).toHaveBeenCalledWith('groups-test', expect.objectContaining({ IndexName: 'GSI1-UserGroups', ExpressionAttributeValues: { ':pk': 'USER#user-1' } }));
  });

  test('does not reveal group contents to non-members', async () => {
    mockGetItem.mockResolvedValueOnce(undefined);
    const response = await groups.getGroup(event({ resource: '/groups/{groupId}', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(404);
    expect(mockQueryTable).not.toHaveBeenCalled();
  });

  test('group details omit member email addresses', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, ownerMembership, memberMembership]);
    const response = await groups.getGroup(event({ resource: '/groups/{groupId}', path: { groupId: 'group-1' } }));

    expect(response.statusCode).toBe(200);
    expect(data(response).group.members).toHaveLength(2);
    expect(data(response).group.members.every((member) => !Object.hasOwn(member, 'email'))).toBe(true);
  });

  test('returns the same response and reserves indistinguishable quota state for every valid unique email', async () => {
    mockGetItem.mockResolvedValue(ownerMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, ownerMembership])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const unknown = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'unknown@example.com' } }));
    const unknownTransaction = mockTransactWrite.mock.calls[0][0];

    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(ownerMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, ownerMembership, memberMembership])
      .mockResolvedValueOnce([{ user_id: 'user-2', email_normalized: 'member@example.com', display_name: 'Group Member' }]);
    const existing = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'member@example.com' } }));
    const existingTransaction = mockTransactWrite.mock.calls[0][0];

    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(ownerMembership);
    mockTransactWrite.mockResolvedValue(undefined);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, ownerMembership])
      .mockResolvedValueOnce([{ user_id: 'user-2', email_normalized: 'member@example.com', display_name: 'Group Member' }]);
    const created = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'MEMBER@example.com' } }));
    const createdTransaction = mockTransactWrite.mock.calls[0][0];

    expect(unknown.statusCode).toBe(202);
    expect(existing.statusCode).toBe(202);
    expect(created.statusCode).toBe(202);
    expect(unknown.body).toBe(existing.body);
    expect(existing.body).toBe(created.body);
    for (const transaction of [unknownTransaction, existingTransaction, createdTransaction]) {
      expect(transaction.find((item) => item.Update).Update.ConditionExpression).toContain('people_count < :max');
    }
    for (const transaction of [unknownTransaction, existingTransaction]) {
      const attempt = transaction.find((item) => item.Put).Put.Item;
      expect(attempt.entity_type).toBe('GROUP_INVITE_ATTEMPT');
      expect(attempt).not.toHaveProperty('email');
      expect(attempt).not.toHaveProperty('GSI1PK');
    }
    const invitePut = createdTransaction.find((item) => item.Put).Put.Item;
    expect(invitePut).toEqual(expect.objectContaining({ entity_type: 'GROUP_INVITE', target_user_id: 'user-2', GSI1PK: 'USER#user-2' }));
    expect(invitePut).not.toHaveProperty('email');
    expect(invitePut.SK).toMatch(/^INVITE#[a-f0-9]{64}$/);
  });

  test('does not let non-owners invite members', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership);
    const response = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, claims: { sub: 'user-2' }, body: { email: 'person@example.com' } }));
    expect(response.statusCode).toBe(403);
    expect(mockQueryTable).not.toHaveBeenCalled();
  });

  test('accepts an invitation transactionally without granting membership beforehand', async () => {
    mockQueryTable.mockResolvedValueOnce([invitation]);
    mockGetItem.mockResolvedValueOnce(groupRecord);
    const response = await groups.acceptInvitation(event({ method: 'POST', path: { groupId: 'group-1' }, claims: { sub: 'user-2' } }));

    expect(response.statusCode).toBe(200);
    const transaction = mockTransactWrite.mock.calls[0][0];
    expect(transaction).toEqual(expect.arrayContaining([
      expect.objectContaining({ Put: expect.objectContaining({ Item: expect.objectContaining({ SK: 'MEMBER#user-2', role: 'member', GSI1PK: 'USER#user-2' }), ConditionExpression: 'attribute_not_exists(PK)' }) }),
      expect.objectContaining({ Delete: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'INVITE#hashed-email' }, ConditionExpression: 'target_user_id = :userId' }) }),
    ]));
  });

  test('declines only an invitation targeting the authenticated recipient', async () => {
    mockQueryTable.mockResolvedValueOnce([invitation]);
    const response = await groups.declineInvitation(event({ method: 'DELETE', path: { groupId: 'group-1' }, claims: { sub: 'user-2' } }));
    expect(response.statusCode).toBe(200);
    expect(mockTransactWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ Delete: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'INVITE#hashed-email' }, ExpressionAttributeValues: { ':userId': 'user-2' } }) }),
      expect.objectContaining({ Update: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'GROUP' }, UpdateExpression: expect.stringContaining('people_count :minusOne') }) }),
    ]));
  });

  test('creates a shared task with commit-time member and assignee conditions', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership);
    mockQueryTable.mockResolvedValueOnce([]);
    const response = await groups.createTask(event({
      method: 'POST',
      path: { groupId: 'group-1' },
      claims: { sub: 'user-2' },
      body: { title: 'Prepare slides', deadline: '2026-08-20T10:00:00.000Z', assigned_to: 'user-1' },
    }));

    expect(response.statusCode).toBe(201);
    expect(data(response).task).toEqual(expect.objectContaining({ assigned_to: 'user-1', created_by: 'user-2' }));
    const transaction = mockTransactWrite.mock.calls[0][0];
    expect(transaction.filter((item) => item.ConditionCheck)).toHaveLength(2);
    expect(transaction).toEqual(expect.arrayContaining([
      expect.objectContaining({ Update: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'GROUP' }, ConditionExpression: expect.stringContaining('task_count < :max') }) }),
      expect.objectContaining({ Put: expect.objectContaining({ Item: expect.objectContaining({ entity_type: 'GROUP_TASK' }), ConditionExpression: 'attribute_not_exists(PK)' }) }),
    ]));
  });

  test('assignee updates use a conditional transaction and reopening canonicalizes progress to zero', async () => {
    mockGetItem
      .mockResolvedValueOnce(memberMembership)
      .mockResolvedValueOnce(taskRecord)
      .mockResolvedValueOnce({ ...taskRecord, status: 'not_started', progress_percentage: 0 });
    const response = await groups.updateTask(event({ method: 'PUT', path: { groupId: 'group-1', taskId: 'task-1' }, claims: { sub: 'user-2' }, body: { status: 'not_started' } }));

    expect(response.statusCode).toBe(200);
    expect(data(response).task).toEqual(expect.objectContaining({ status: 'not_started', progress_percentage: 0 }));
    const update = mockTransactWrite.mock.calls[0][0].find((item) => item.Update).Update;
    expect(update.ConditionExpression).toContain('assigned_to = :userId');
    expect(Object.values(update.ExpressionAttributeValues)).toEqual(expect.arrayContaining(['not_started', 0, 'user-2']));
  });

  test('assignee cannot rewrite task details', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership).mockResolvedValueOnce(taskRecord);
    const response = await groups.updateTask(event({ method: 'PUT', path: { groupId: 'group-1', taskId: 'task-1' }, claims: { sub: 'user-2' }, body: { title: 'Changed title' } }));
    expect(response.statusCode).toBe(403);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('removing a member atomically unassigns their tasks', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership).mockResolvedValueOnce(memberMembership);
    mockQueryTable.mockResolvedValueOnce([taskRecord]);
    const response = await groups.removeMember(event({ method: 'DELETE', path: { groupId: 'group-1', memberId: 'user-2' } }));

    expect(response.statusCode).toBe(200);
    expect(mockTransactWrite).toHaveBeenCalledTimes(3);
    expect(mockTransactWrite.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ Update: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-2' }, UpdateExpression: expect.stringContaining('removing = :true') }) }),
    ]));
    expect(mockTransactWrite.mock.calls[1][0]).toEqual([
      expect.objectContaining({ Update: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'TASK#task-1' }, ConditionExpression: 'assigned_to = :memberId AND entity_type = :entity' }) }),
    ]);
    expect(mockTransactWrite.mock.calls[2][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ Delete: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-2' }, ConditionExpression: expect.stringContaining('removing = :true') }) }),
      expect.objectContaining({ Update: expect.objectContaining({ UpdateExpression: expect.stringContaining('people_count :minusOne') }) }),
    ]));
  });

  test('prevents owner leave through member deletion', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership).mockResolvedValueOnce(ownerMembership);
    const response = await groups.removeMember(event({ method: 'DELETE', path: { groupId: 'group-1', memberId: 'user-1' } }));
    expect(response.statusCode).toBe(409);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('owner deletion marks the group before batch-deleting the whole partition', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, ownerMembership, memberMembership, invitation, taskRecord]);
    const response = await groups.deleteGroup(event({ method: 'DELETE', path: { groupId: 'group-1' } }));

    expect(response.statusCode).toBe(200);
    expect(mockTransactWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ ConditionCheck: expect.objectContaining({ ConditionExpression: expect.stringContaining('#role = :role') }) }),
      expect.objectContaining({ Update: expect.objectContaining({ UpdateExpression: expect.stringContaining('deleting = :true') }) }),
    ]));
    expect(mockBatchWriteTable).toHaveBeenCalledWith('groups-test', expect.arrayContaining([
      { DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-2' } } },
      { DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'TASK#task-1' } } },
    ]));
    const cleanupRequests = mockBatchWriteTable.mock.calls[0][1];
    expect(cleanupRequests).not.toContainEqual({ DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'GROUP' } } });
    expect(cleanupRequests).not.toContainEqual({ DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-1' } } });
    expect(mockTransactWrite.mock.calls[1][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ Delete: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'GROUP' }, ConditionExpression: expect.stringContaining('deleting = :true') }) }),
      expect.objectContaining({ Delete: expect.objectContaining({ Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-1' } }) }),
      expect.objectContaining({ Update: expect.objectContaining({ Key: { PK: 'USER#user-1', SK: 'OWNED_GROUPS' } }) }),
    ]));
  });

  test('non-owner cannot delete a group', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership);
    const response = await groups.deleteGroup(event({ method: 'DELETE', path: { groupId: 'group-1' }, claims: { sub: 'user-2' } }));
    expect(response.statusCode).toBe(403);
    expect(mockBatchWriteTable).not.toHaveBeenCalled();
  });


  test('invite quota rejection remains indistinguishable from a successful generic invitation', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, ownerMembership])
      .mockResolvedValueOnce([{ user_id: 'user-2', email_normalized: 'member@example.com', display_name: 'Group Member' }]);
    mockTransactWrite.mockRejectedValueOnce(Object.assign(new Error('quota'), { name: 'TransactionCanceledException' }));
    const response = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'member@example.com' } }));
    expect(response.statusCode).toBe(202);
    expect(data(response).message).toMatch(/If that account can be invited/);
    const groupCounter = mockTransactWrite.mock.calls[0][0].find((item) => item.Update).Update;
    expect(groupCounter.ConditionExpression).toContain('people_count < :max');
  });

  test('legacy mixed-case email profiles remain invitable through exact normalized fallback', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, ownerMembership])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockScanTable.mockResolvedValueOnce([{ user_id: 'user-2', email: 'Member@Example.com', display_name: 'Group Member' }]);
    const response = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'member@example.com' } }));
    expect(response.statusCode).toBe(202);
    expect(mockTransactWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ Put: expect.objectContaining({ Item: expect.objectContaining({ target_user_id: 'user-2' }) }) }),
    ]));
  });

  test('owner can atomically clear pending invitations and release every reserved slot', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable.mockResolvedValueOnce([invitation, { ...invitation, SK: 'INVITE#attempt-hash', entity_type: 'GROUP_INVITE_ATTEMPT', target_user_id: undefined }]);
    const response = await groups.declineInvitation(event({ method: 'DELETE', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(200);
    const transaction = mockTransactWrite.mock.calls[0][0];
    expect(transaction.filter((item) => item.Delete)).toHaveLength(2);
    const counter = transaction.find((item) => item.Update).Update;
    expect(counter.ExpressionAttributeValues).toEqual(expect.objectContaining({ ':decrement': -2, ':count': 2 }));
  });

  test('partial group cleanup retains final authorization records so deletion can be retried', async () => {
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, ownerMembership, taskRecord]);
    mockBatchWriteTable.mockRejectedValueOnce(new Error('timeout'));
    const response = await groups.deleteGroup(event({ method: 'DELETE', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(500);
    expect(mockTransactWrite).toHaveBeenCalledTimes(1);
    const cleanup = mockBatchWriteTable.mock.calls[0][1];
    expect(cleanup).toEqual([{ DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'TASK#task-1' } } }]);
  });

  test('routes invitation consent and group deletion endpoints', async () => {
    mockQueryTable.mockResolvedValueOnce([invitation]);
    mockGetItem.mockResolvedValueOnce(groupRecord);
    const accepted = await groups.handler(event({ method: 'POST', resource: '/groups/{groupId}/invitations/accept', path: { groupId: 'group-1' }, claims: { sub: 'user-2' } }));
    expect(accepted.statusCode).toBe(200);

    jest.clearAllMocks();
    mockGetItem.mockResolvedValueOnce(ownerMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, ownerMembership]);
    mockTransactWrite.mockResolvedValue(undefined);
    mockBatchWriteTable.mockResolvedValue(undefined);
    const deleted = await groups.handler(event({ method: 'DELETE', resource: '/groups/{groupId}', path: { groupId: 'group-1' } }));
    expect(deleted.statusCode).toBe(200);
  });
});
