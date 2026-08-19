const { createHash } = require('node:crypto');

const mockGetItem = jest.fn();
const mockQueryTable = jest.fn();
const mockScanTable = jest.fn();
const mockTransactWrite = jest.fn();
const mockBatchWriteTable = jest.fn();
const mockSesSend = jest.fn();

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

jest.mock('@aws-sdk/client-sesv2', () => {
  class SendEmailCommand {
    constructor(input) { this.input = input; }
  }
  return {
    SESv2Client: jest.fn(() => ({ send: mockSesSend })),
    SendEmailCommand,
  };
});

process.env.GROUP_INVITE_FROM_EMAIL = 'groups@example.com';
process.env.APP_URL = 'https://app.example.com/';

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
          email_verified: 'true',
          name: 'Owner Student',
          'cognito:username': 'owner',
          ...claims,
        },
      },
    },
  };
}

function payload(response) { return JSON.parse(response.body); }
function data(response) { return payload(response).data; }
function hash(email) { return createHash('sha256').update(email).digest('hex'); }

const groupRecord = {
  PK: 'GROUP#group-1',
  SK: 'GROUP',
  entity_type: 'GROUP',
  group_id: 'group-1',
  name: 'Study Circle',
  description: 'Prepare together',
  color: '#2563eb',
  visibility: 'private',
  owner_id: 'user-1',
  people_count: 2,
  task_count: 1,
  created_at: '2026-08-18T10:00:00.000Z',
  updated_at: '2026-08-18T10:00:00.000Z',
};

const adminMembership = {
  PK: 'GROUP#group-1',
  SK: 'MEMBER#user-1',
  entity_type: 'GROUP_MEMBER',
  GSI1PK: 'USER#user-1',
  GSI1SK: 'GROUP#2026-08-18T10:00:00.000Z#group-1',
  group_id: 'group-1',
  group_name: 'Study Circle',
  group_description: 'Prepare together',
  group_color: '#2563eb',
  group_visibility: 'private',
  owner_id: 'user-1',
  user_id: 'user-1',
  display_name: 'Owner Student',
  role: 'admin',
  joined_at: '2026-08-18T10:00:00.000Z',
};

const legacyOwnerMembership = { ...adminMembership, role: 'owner' };
const memberMembership = {
  ...adminMembership,
  SK: 'MEMBER#user-2',
  GSI1PK: 'USER#user-2',
  user_id: 'user-2',
  display_name: 'Group Member',
  role: 'member',
};
const secondAdminMembership = {
  ...memberMembership,
  user_id: 'user-2',
  SK: 'MEMBER#user-2',
  role: 'admin',
};

const invitation = {
  PK: 'GROUP#group-1',
  SK: `INVITE#${hash('member@example.com')}`,
  entity_type: 'GROUP_INVITE',
  GSI1PK: 'USER#user-2',
  GSI1SK: 'INVITE#2026-08-18T11:00:00.000Z#group-1',
  group_id: 'group-1',
  group_name: 'Study Circle',
  group_description: 'Prepare together',
  group_color: '#2563eb',
  owner_id: 'user-1',
  target_user_id: 'user-2',
  target_email_hash: hash('member@example.com'),
  target_display_name: 'Group Member',
  invited_by: 'user-1',
  invited_by_name: 'Owner Student',
  created_at: '2026-08-18T11:00:00.000Z',
};

const emailInvitation = {
  ...invitation,
  SK: `INVITE#${hash('new@example.com')}`,
  GSI1PK: `EMAIL#${hash('new@example.com')}`,
  target_email_hash: hash('new@example.com'),
  target_user_id: undefined,
  target_display_name: undefined,
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
  status: 'in_progress',
  progress_percentage: 50,
  assigned_to: 'user-2',
  created_by: 'user-2',
  created_by_name: 'Group Member',
  created_at: '2026-08-18T10:00:00.000Z',
  updated_at: '2026-08-18T10:00:00.000Z',
};

describe('groups collaboration handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockReset();
    mockQueryTable.mockReset().mockResolvedValue([]);
    mockScanTable.mockReset().mockResolvedValue([]);
    mockTransactWrite.mockReset().mockResolvedValue(undefined);
    mockBatchWriteTable.mockReset().mockResolvedValue(undefined);
    mockSesSend.mockReset().mockResolvedValue({ MessageId: 'message-1' });
  });

  test('creates private groups by default with an admin creator and no public index keys', async () => {
    const response = await groups.createGroup(event({
      method: 'POST',
      body: { name: ' Study Circle ', description: ' Prepare together ', color: '#7c3aed' },
    }));

    expect(response.statusCode).toBe(201);
    expect(data(response).group).toEqual(expect.objectContaining({
      group_id: 'generated-id', name: 'Study Circle', role: 'admin', visibility: 'private',
    }));
    const puts = mockTransactWrite.mock.calls[0][0].filter((item) => item.Put).map((item) => item.Put.Item);
    expect(puts[0]).toEqual(expect.objectContaining({ entity_type: 'GROUP', visibility: 'private', owner_id: 'user-1' }));
    expect(puts[0]).not.toHaveProperty('GSI2PK');
    expect(puts[1]).toEqual(expect.objectContaining({ entity_type: 'GROUP_MEMBER', role: 'admin', group_visibility: 'private' }));
  });

  test('indexes newly-created public groups for discovery', async () => {
    const response = await groups.createGroup(event({ method: 'POST', body: { name: 'Open Study', visibility: 'public' } }));
    expect(response.statusCode).toBe(201);
    const group = mockTransactWrite.mock.calls[0][0].find((item) => item.Put?.Item.entity_type === 'GROUP').Put.Item;
    expect(group).toEqual(expect.objectContaining({
      visibility: 'public', GSI2PK: 'PUBLIC_GROUPS', GSI2SK: expect.stringContaining('GROUP#'),
    }));
  });

  test('lists memberships, ID/email invitations, and public groups excluding memberships', async () => {
    const publicOne = { ...groupRecord, group_id: 'public-1', PK: 'GROUP#public-1', visibility: 'public', GSI2PK: 'PUBLIC_GROUPS' };
    const alreadyJoined = { ...groupRecord, visibility: 'public', GSI2PK: 'PUBLIC_GROUPS' };
    const emailHash = hash('owner@example.com');
    const byEmail = { ...emailInvitation, GSI1PK: `EMAIL#${emailHash}`, target_email_hash: emailHash };
    const byUser = { ...invitation, target_user_id: 'user-1' };
    mockQueryTable
      .mockResolvedValueOnce([legacyOwnerMembership, byUser])
      .mockResolvedValueOnce([byEmail])
      .mockResolvedValueOnce([alreadyJoined, publicOne]);

    const response = await groups.listGroups(event());

    expect(response.statusCode).toBe(200);
    expect(data(response).groups).toEqual([expect.objectContaining({ group_id: 'group-1', role: 'admin', visibility: 'private' })]);
    expect(data(response).invitations).toHaveLength(2);
    expect(data(response).invitations.every((item) => !Object.hasOwn(item, 'target_user_id'))).toBe(true);
    expect(data(response).public_groups).toEqual([{
      group_id: 'public-1',
      name: 'Study Circle',
      description: 'Prepare together',
      color: '#2563eb',
      visibility: 'public',
      people_count: 2,
    }]);
    expect(data(response).public_groups[0]).not.toHaveProperty('owner_id');
    expect(data(response).public_groups[0]).not.toHaveProperty('created_at');
    expect(mockQueryTable).toHaveBeenNthCalledWith(2, 'groups-test', expect.objectContaining({
      IndexName: 'GSI1-UserGroups', ExpressionAttributeValues: { ':pk': `EMAIL#${emailHash}` },
    }));
    expect(mockQueryTable).toHaveBeenNthCalledWith(3, 'groups-test', expect.objectContaining({
      IndexName: 'GSI2-PublicGroups', Limit: 25,
    }));
  });

  test('does not use an unverified email claim to list email-addressed invitations', async () => {
    mockQueryTable.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const response = await groups.listGroups(event({ claims: { email_verified: 'false' } }));
    expect(response.statusCode).toBe(200);
    expect(mockQueryTable).toHaveBeenCalledTimes(2);
    expect(data(response).invitations).toEqual([]);
  });

  test('keeps private group details inaccessible to non-members and omits member emails', async () => {
    mockGetItem.mockResolvedValueOnce(undefined);
    let response = await groups.getGroup(event({ resource: '/groups/{groupId}', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(404);

    mockGetItem.mockResolvedValueOnce(legacyOwnerMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, legacyOwnerMembership, memberMembership]);
    response = await groups.getGroup(event({ resource: '/groups/{groupId}', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(200);
    expect(data(response).group.role).toBe('admin');
    expect(data(response).group.members.every((member) => !Object.hasOwn(member, 'email'))).toBe(true);
  });

  test('admins update visibility and synchronize every active member snapshot atomically', async () => {
    mockGetItem.mockResolvedValueOnce(adminMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, adminMembership, memberMembership]);
    const response = await groups.updateGroup(event({
      method: 'PUT', resource: '/groups/{groupId}', path: { groupId: 'group-1' }, body: { visibility: 'public' },
    }));

    expect(response.statusCode).toBe(200);
    expect(data(response).group.visibility).toBe('public');
    const transaction = mockTransactWrite.mock.calls[0][0];
    const requesterSnapshotUpdate = transaction.find((item) => item.Update?.Key.SK === 'MEMBER#user-1').Update;
    expect(requesterSnapshotUpdate.ConditionExpression).toContain('#role = :admin OR #role = :owner');
    expect(transaction.find((item) => item.Update?.Key.SK === 'GROUP').Update).toEqual(expect.objectContaining({
      UpdateExpression: expect.stringContaining('GSI2PK = :gsiPk'),
      ExpressionAttributeValues: expect.objectContaining({ ':gsiPk': 'PUBLIC_GROUPS' }),
    }));
    expect(transaction.filter((item) => item.Update?.UpdateExpression === 'SET group_visibility = :visibility')).toHaveLength(2);
  });

  test('members cannot change visibility', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership);
    const response = await groups.updateGroup(event({
      method: 'PUT', path: { groupId: 'group-1' }, claims: { sub: 'user-2' }, body: { visibility: 'public' },
    }));
    expect(response.statusCode).toBe(403);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('joins a public group transactionally with visibility and capacity checks', async () => {
    mockGetItem.mockResolvedValueOnce({ ...groupRecord, visibility: 'public' });
    const response = await groups.joinGroup(event({ method: 'POST', path: { groupId: 'group-1' }, claims: { sub: 'user-3', email: 'joiner@example.com', name: 'Joiner' } }));

    expect(response.statusCode).toBe(200);
    const transaction = mockTransactWrite.mock.calls[0][0];
    expect(transaction[0].Update.ConditionExpression).toContain('visibility = :public AND people_count < :max');
    expect(transaction[1].Put).toEqual(expect.objectContaining({
      Item: expect.objectContaining({ SK: 'MEMBER#user-3', role: 'member', group_visibility: 'public' }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  });

  test('does not join private groups and maps transaction contention to a safe conflict', async () => {
    mockGetItem.mockResolvedValueOnce(groupRecord);
    expect((await groups.joinGroup(event({ method: 'POST', path: { groupId: 'group-1' } }))).statusCode).toBe(404);

    mockGetItem.mockResolvedValueOnce({ ...groupRecord, visibility: 'public' });
    mockTransactWrite.mockRejectedValueOnce(Object.assign(new Error('full'), { name: 'TransactionCanceledException' }));
    const response = await groups.joinGroup(event({ method: 'POST', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(409);
  });

  test('public join consumes a matching invitation without double-incrementing reserved capacity', async () => {
    const publicGroup = { ...groupRecord, visibility: 'public' };
    mockGetItem.mockResolvedValueOnce(publicGroup);
    mockQueryTable.mockResolvedValueOnce([emailInvitation]);
    const response = await groups.joinGroup(event({
      method: 'POST', path: { groupId: 'group-1' }, claims: { sub: 'new-user', email: 'new@example.com', name: 'New User' },
    }));

    expect(response.statusCode).toBe(200);
    const transaction = mockTransactWrite.mock.calls[0][0];
    expect(transaction[0].ConditionCheck.ConditionExpression).toContain('people_count <= :max');
    expect(transaction.some((item) => item.Update?.UpdateExpression?.includes('people_count'))).toBe(false);
    expect(transaction.find((item) => item.Delete).Delete.ExpressionAttributeValues).toEqual({
      ':userId': 'new-user', ':emailHash': hash('new@example.com'),
    });
  });

  test('durably indexes unknown-email invitations by hash, stores no raw email, and sends SES', async () => {
    mockGetItem.mockResolvedValueOnce(adminMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, adminMembership])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'NEW@example.com' } }));

    expect(response.statusCode).toBe(202);
    const invite = mockTransactWrite.mock.calls[0][0].find((item) => item.Put).Put.Item;
    expect(invite).toEqual(expect.objectContaining({
      entity_type: 'GROUP_INVITE', GSI1PK: `EMAIL#${hash('new@example.com')}`, target_email_hash: hash('new@example.com'),
    }));
    expect(invite).not.toHaveProperty('email');
    expect(JSON.stringify(invite)).not.toContain('new@example.com');
    expect(mockSesSend).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      FromEmailAddress: 'groups@example.com', Destination: { ToAddresses: ['new@example.com'] },
    }) }));
    expect(mockSesSend.mock.calls[0][0].input.Content.Simple.Body.Text.Data).toContain('https://app.example.com/groups');
    expect(mockSesSend.mock.calls[0][0].input.Content.Simple.Body.Text.Data).toContain('invited this email address');
    expect(mockSesSend.mock.calls[0][0].input.Content.Simple.Body.Text.Data).toContain('sign in or create an account');
  });

  test('indexes known-account invitations by user and preserves a generic response for ineligible emails', async () => {
    mockGetItem.mockResolvedValue(adminMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, adminMembership])
      .mockResolvedValueOnce([{ user_id: 'user-2', email_normalized: 'member@example.com', display_name: 'Group Member' }]);
    const eligible = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'member@example.com' } }));
    const eligibleInvite = mockTransactWrite.mock.calls[0][0].find((item) => item.Put).Put.Item;

    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(adminMembership);
    mockTransactWrite.mockResolvedValue(undefined);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, adminMembership, memberMembership])
      .mockResolvedValueOnce([{ user_id: 'user-2', email_normalized: 'member@example.com', display_name: 'Group Member' }]);
    const ineligible = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'member@example.com' } }));
    const attempt = mockTransactWrite.mock.calls[0][0].find((item) => item.Put).Put.Item;

    expect(eligible.body).toBe(ineligible.body);
    expect(eligibleInvite).toEqual(expect.objectContaining({ entity_type: 'GROUP_INVITE', GSI1PK: 'USER#user-2', target_user_id: 'user-2' }));
    expect(attempt.entity_type).toBe('GROUP_INVITE_ATTEMPT');
    expect(attempt).not.toHaveProperty('GSI1PK');
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  test('lets another Admin retry SES after failed delivery without replacing the invitation or reserving another slot', async () => {
    mockGetItem
      .mockResolvedValueOnce(adminMembership)
      .mockResolvedValueOnce(secondAdminMembership);
    mockQueryTable
      .mockResolvedValueOnce([groupRecord, adminMembership])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([groupRecord, secondAdminMembership, emailInvitation])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockSesSend
      .mockRejectedValueOnce(Object.assign(new Error('SES unavailable'), { name: 'ServiceUnavailableException' }))
      .mockResolvedValueOnce({ MessageId: 'retry-message' });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const invitationEvent = event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'new@example.com' } });
    const retryEvent = event({
      method: 'POST',
      path: { groupId: 'group-1' },
      body: { email: 'new@example.com' },
      claims: { sub: 'user-2', email: 'admin2@example.com', name: 'Second Admin' },
    });

    const firstResponse = await groups.inviteMember(invitationEvent);
    const retryResponse = await groups.inviteMember(retryEvent);

    expect(firstResponse.statusCode).toBe(202);
    expect(retryResponse.body).toBe(firstResponse.body);
    expect(mockSesSend).toHaveBeenCalledTimes(2);
    expect(mockTransactWrite).toHaveBeenCalledTimes(2);
    const initialTransaction = mockTransactWrite.mock.calls[0][0];
    expect(initialTransaction.find((item) => item.Update).Update.UpdateExpression).toContain('people_count :one');
    expect(initialTransaction.find((item) => item.Put).Put.Item).toEqual(expect.objectContaining({
      SK: emailInvitation.SK,
      target_email_hash: hash('new@example.com'),
      invited_by: 'user-1',
    }));
    const retryTransaction = mockTransactWrite.mock.calls[1][0];
    expect(retryTransaction).toHaveLength(2);
    expect(retryTransaction.every((item) => item.ConditionCheck)).toBe(true);
    expect(retryTransaction.some((item) => item.Update || item.Put || item.Delete)).toBe(false);
    expect(retryTransaction[0].ConditionCheck).toEqual(expect.objectContaining({
      Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-2' },
      ExpressionAttributeValues: { ':admin': 'admin', ':owner': 'owner' },
    }));
    expect(retryTransaction[1].ConditionCheck).toEqual(expect.objectContaining({
      Key: { PK: 'GROUP#group-1', SK: emailInvitation.SK },
      ConditionExpression: 'entity_type = :invite AND target_email_hash = :emailHash',
      ExpressionAttributeValues: { ':invite': 'GROUP_INVITE', ':emailHash': hash('new@example.com') },
    }));
    expect(consoleSpy).toHaveBeenCalledWith('Failed to send group invitation email', { category: 'ServiceUnavailableException' });
    consoleSpy.mockRestore();
  });

  test('legacy owner memberships retain admin invitation privileges', async () => {
    mockGetItem.mockResolvedValueOnce(legacyOwnerMembership);
    mockQueryTable.mockResolvedValueOnce([groupRecord, legacyOwnerMembership]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const response = await groups.inviteMember(event({ method: 'POST', path: { groupId: 'group-1' }, body: { email: 'new@example.com' } }));
    expect(response.statusCode).toBe(202);
    expect(mockTransactWrite.mock.calls[0][0][0].ConditionCheck.ExpressionAttributeValues).toEqual({ ':admin': 'admin', ':owner': 'owner' });
  });

  test('accepts an unknown-email invitation using the authenticated verified email hash', async () => {
    mockQueryTable.mockResolvedValueOnce([emailInvitation]);
    mockGetItem.mockResolvedValueOnce(groupRecord);
    const response = await groups.acceptInvitation(event({
      method: 'POST', path: { groupId: 'group-1' }, claims: { sub: 'new-user', email: 'new@example.com', name: 'New User' },
    }));

    expect(response.statusCode).toBe(200);
    const transaction = mockTransactWrite.mock.calls[0][0];
    expect(transaction.find((item) => item.Put).Put.Item).toEqual(expect.objectContaining({
      SK: 'MEMBER#new-user', display_name: 'New User', role: 'member',
    }));
    expect(transaction.find((item) => item.Delete).Delete).toEqual(expect.objectContaining({
      ConditionExpression: '(target_user_id = :userId OR target_email_hash = :emailHash)',
      ExpressionAttributeValues: { ':userId': 'new-user', ':emailHash': hash('new@example.com') },
    }));
  });

  test('does not resolve an email-addressed invitation from an unverified email claim', async () => {
    mockQueryTable.mockResolvedValueOnce([emailInvitation]);
    mockGetItem.mockResolvedValueOnce(groupRecord);
    const response = await groups.acceptInvitation(event({
      method: 'POST', path: { groupId: 'group-1' }, claims: { sub: 'new-user', email: 'new@example.com', email_verified: 'false' },
    }));
    expect(response.statusCode).toBe(404);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('declines invitations resolved by verified email hash and releases the reserved slot', async () => {
    mockGetItem.mockResolvedValueOnce(undefined);
    mockQueryTable.mockResolvedValueOnce([emailInvitation]);
    const response = await groups.declineInvitation(event({
      method: 'DELETE', path: { groupId: 'group-1' }, claims: { sub: 'new-user', email: 'new@example.com' },
    }));
    expect(response.statusCode).toBe(200);
    expect(mockTransactWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ Delete: expect.objectContaining({ ExpressionAttributeValues: expect.objectContaining({ ':emailHash': hash('new@example.com') }) }) }),
      expect.objectContaining({ Update: expect.objectContaining({ UpdateExpression: expect.stringContaining('people_count :minusOne') }) }),
    ]));
  });

  test('admins promote members and creator demotion is prohibited', async () => {
    mockGetItem
      .mockResolvedValueOnce(adminMembership)
      .mockResolvedValueOnce(memberMembership)
      .mockResolvedValueOnce(groupRecord);
    let response = await groups.updateMemberRole(event({ method: 'PUT', path: { groupId: 'group-1', memberId: 'user-2' }, body: { role: 'admin' } }));
    expect(response.statusCode).toBe(200);
    expect(data(response).member.role).toBe('admin');
    expect(mockTransactWrite.mock.calls[0][0][2].Update.ExpressionAttributeValues[':role']).toBe('admin');

    jest.clearAllMocks();
    mockGetItem.mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(groupRecord);
    response = await groups.updateMemberRole(event({ method: 'PUT', path: { groupId: 'group-1', memberId: 'user-1' }, body: { role: 'member' } }));
    expect(response.statusCode).toBe(409);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('members cannot manage roles', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership).mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(groupRecord);
    const response = await groups.updateMemberRole(event({
      method: 'PUT', path: { groupId: 'group-1', memberId: 'user-1' }, claims: { sub: 'user-2' }, body: { role: 'member' },
    }));
    expect(response.statusCode).toBe(403);
  });

  test('admins remove other admins and unassign their tasks, but never remove the creator', async () => {
    mockGetItem.mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(secondAdminMembership).mockResolvedValueOnce(groupRecord);
    mockQueryTable.mockResolvedValueOnce([taskRecord]);
    let response = await groups.removeMember(event({ method: 'DELETE', path: { groupId: 'group-1', memberId: 'user-2' } }));
    expect(response.statusCode).toBe(200);
    expect(mockTransactWrite).toHaveBeenCalledTimes(3);
    expect(mockTransactWrite.mock.calls[1][0][0].Update.UpdateExpression).toContain('assigned_to = :none');

    jest.clearAllMocks();
    mockGetItem.mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(groupRecord);
    response = await groups.removeMember(event({ method: 'DELETE', path: { groupId: 'group-1', memberId: 'user-1' } }));
    expect(response.statusCode).toBe(409);
    expect(mockTransactWrite).not.toHaveBeenCalled();
  });

  test('group deletion is creator-only regardless of other admins and supports legacy creator role', async () => {
    mockGetItem.mockResolvedValueOnce(secondAdminMembership).mockResolvedValueOnce(groupRecord);
    let response = await groups.deleteGroup(event({ method: 'DELETE', path: { groupId: 'group-1' }, claims: { sub: 'user-2' } }));
    expect(response.statusCode).toBe(403);

    mockGetItem.mockResolvedValueOnce(legacyOwnerMembership).mockResolvedValueOnce(groupRecord);
    mockQueryTable.mockResolvedValueOnce([groupRecord, legacyOwnerMembership, memberMembership, taskRecord]);
    response = await groups.deleteGroup(event({ method: 'DELETE', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(200);
    expect(mockBatchWriteTable).toHaveBeenCalledWith('groups-test', expect.arrayContaining([
      { DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'MEMBER#user-2' } } },
      { DeleteRequest: { Key: { PK: 'GROUP#group-1', SK: 'TASK#task-1' } } },
    ]));
    expect(mockTransactWrite.mock.calls[1][0].find((item) => item.Delete?.Key.SK === 'MEMBER#user-1').Delete.ConditionExpression).toContain('entity_type = :member');
  });

  test('admins can manage tasks and legacy owners satisfy commit-time admin checks', async () => {
    mockGetItem
      .mockResolvedValueOnce(legacyOwnerMembership)
      .mockResolvedValueOnce(taskRecord)
      .mockResolvedValueOnce({ ...taskRecord, title: 'Admin edit' });
    const response = await groups.updateTask(event({ method: 'PUT', path: { groupId: 'group-1', taskId: 'task-1' }, body: { title: 'Admin edit' } }));
    expect(response.statusCode).toBe(200);
    const condition = mockTransactWrite.mock.calls[0][0][0].ConditionCheck;
    expect(condition.ExpressionAttributeValues).toEqual({ ':admin': 'admin', ':owner': 'owner' });
  });

  test('routes the new update, join, and member-role endpoints', async () => {
    mockGetItem.mockResolvedValueOnce(memberMembership);
    let response = await groups.handler(event({ method: 'PUT', resource: '/groups/{groupId}', path: { groupId: 'group-1' }, claims: { sub: 'user-2' }, body: { visibility: 'public' } }));
    expect(response.statusCode).toBe(403);

    mockGetItem.mockResolvedValueOnce(groupRecord);
    response = await groups.handler(event({ method: 'POST', resource: '/groups/{groupId}/join', path: { groupId: 'group-1' } }));
    expect(response.statusCode).toBe(404);

    mockGetItem.mockResolvedValueOnce(memberMembership).mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(groupRecord);
    response = await groups.handler(event({ method: 'PUT', resource: '/groups/{groupId}/members/{memberId}', path: { groupId: 'group-1', memberId: 'user-1' }, claims: { sub: 'user-2' }, body: { role: 'member' } }));
    expect(response.statusCode).toBe(403);
  });
});
