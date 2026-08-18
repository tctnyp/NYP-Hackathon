const { createHash } = require('crypto');
const {
  GROUPS_TABLE,
  USERS_TABLE,
  getItem,
  queryTable,
  scanTable,
  transactWrite,
  batchWriteTable,
  generateId,
  timestamp,
} = require('../utils/database');
const {
  success,
  error,
  getUserId,
  getUserEmail,
  getUsername,
  getUserName,
  parseBody,
} = require('../utils/response');

const GROUP_COLORS = new Set(['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2', '#475569']);
const TASK_STATUSES = new Set(['not_started', 'in_progress', 'completed']);
const MAX_GROUP_MEMBERS = 50;
const MAX_OWNED_GROUPS = 30;
const MAX_GROUP_TASKS = 500;

function validatedText(value, label, maxLength, required = false) {
  if (value === undefined || value === null || value === '') {
    return required ? { error: `${label} is required` } : { value: '' };
  }
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const clean = value.trim();
  if (required && !clean) return { error: `${label} is required` };
  if (clean.length > maxLength) return { error: `${label} must be ${maxLength} characters or fewer` };
  return { value: clean };
}

function publicGroup(group) {
  return {
    group_id: group.group_id,
    name: group.name,
    description: group.description || '',
    color: group.color,
    owner_id: group.owner_id,
    created_at: group.created_at,
    updated_at: group.updated_at,
  };
}

function publicMember(member) {
  return {
    user_id: member.user_id,
    display_name: member.display_name,
    role: member.role,
    joined_at: member.joined_at,
  };
}

function publicInvitation(invitation) {
  return {
    group_id: invitation.group_id,
    group_name: invitation.group_name,
    group_description: invitation.group_description || '',
    group_color: invitation.group_color,
    invited_by_name: invitation.invited_by_name,
    created_at: invitation.created_at,
  };
}

function publicTask(task) {
  return {
    task_id: task.task_id,
    group_id: task.group_id,
    title: task.title,
    description: task.description || '',
    deadline: task.deadline,
    status: task.status,
    progress_percentage: task.progress_percentage,
    assigned_to: task.assigned_to || null,
    created_by: task.created_by,
    created_by_name: task.created_by_name,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function ownerSnapshot(event, userId) {
  const email = (getUserEmail(event) || '').trim().toLowerCase();
  const displayName = String(getUserName(event) || getUsername(event) || email.split('@')[0] || 'Member').trim().slice(0, 120);
  return { user_id: userId, display_name: displayName };
}

function memberKey(groupId, userId) {
  return { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` };
}

function invitationKey(groupId, emailNormalized) {
  const hash = createHash('sha256').update(emailNormalized).digest('hex');
  return { PK: `GROUP#${groupId}`, SK: `INVITE#${hash}` };
}

async function recipientInvitation(groupId, userId) {
  const invitations = await queryTable(GROUPS_TABLE, {
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :invite)',
    ExpressionAttributeValues: { ':pk': `GROUP#${groupId}`, ':invite': 'INVITE#' },
    ConsistentRead: true,
  });
  return invitations.find((item) => item.entity_type === 'GROUP_INVITE' && item.target_user_id === userId);
}

async function membership(groupId, userId) {
  return getItem(GROUPS_TABLE, memberKey(groupId, userId));
}

async function groupRecord(groupId) {
  return getItem(GROUPS_TABLE, { PK: `GROUP#${groupId}`, SK: 'GROUP' });
}

async function requireMember(groupId, userId) {
  if (!groupId || !userId) return null;
  const item = await membership(groupId, userId);
  return item && !item.removing ? item : null;
}

function membershipCondition(groupId, userId, role) {
  const roleCondition = role ? ' AND #role = :role' : '';
  return {
    ConditionCheck: {
      TableName: GROUPS_TABLE,
      Key: memberKey(groupId, userId),
      ConditionExpression: `attribute_exists(PK) AND attribute_not_exists(removing)${roleCondition}`,
      ExpressionAttributeNames: role ? { '#role': 'role' } : undefined,
      ExpressionAttributeValues: role ? { ':role': role } : undefined,
    },
  };
}

function activeGroupCondition(groupId) {
  return {
    ConditionCheck: {
      TableName: GROUPS_TABLE,
      Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting)',
    },
  };
}

exports.listGroups = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const records = await queryTable(GROUPS_TABLE, {
      IndexName: 'GSI1-UserGroups',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}` },
      ScanIndexForward: false,
    });
    const groups = records
      .filter((item) => item.entity_type === 'GROUP_MEMBER' && !item.removing)
      .map((item) => ({
        group_id: item.group_id,
        name: item.group_name,
        description: item.group_description || '',
        color: item.group_color,
        owner_id: item.owner_id,
        role: item.role,
        joined_at: item.joined_at,
      }));
    const invitations = records
      .filter((item) => item.entity_type === 'GROUP_INVITE')
      .map(publicInvitation);
    return success({ groups, invitations });
  } catch (err) {
    console.error('Error listing groups:', err);
    return error('Failed to load groups', 500);
  }
};

exports.createGroup = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const body = parseBody(event);
    if (!body) return error('Invalid JSON body', 400);
    const nameResult = validatedText(body.name, 'Group name', 80, true);
    const descriptionResult = validatedText(body.description, 'Description', 500);
    if (nameResult.error) return error(nameResult.error, 400);
    if (descriptionResult.error) return error(descriptionResult.error, 400);

    const color = GROUP_COLORS.has(body.color) ? body.color : '#2563eb';
    const groupId = generateId();
    const now = timestamp();
    const owner = ownerSnapshot(event, userId);
    const group = {
      PK: `GROUP#${groupId}`,
      SK: 'GROUP',
      entity_type: 'GROUP',
      group_id: groupId,
      name: nameResult.value,
      description: descriptionResult.value,
      color,
      owner_id: userId,
      people_count: 1,
      task_count: 0,
      created_at: now,
      updated_at: now,
    };
    const ownerMembership = {
      PK: `GROUP#${groupId}`,
      SK: `MEMBER#${userId}`,
      entity_type: 'GROUP_MEMBER',
      GSI1PK: `USER#${userId}`,
      GSI1SK: `GROUP#${now}#${groupId}`,
      group_id: groupId,
      group_name: group.name,
      group_description: group.description,
      group_color: color,
      owner_id: userId,
      ...owner,
      role: 'owner',
      joined_at: now,
    };
    await transactWrite([
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `USER#${userId}`, SK: 'OWNED_GROUPS' },
          UpdateExpression: 'SET entity_type = :entity, updated_at = :now ADD owned_count :one',
          ConditionExpression: 'attribute_not_exists(owned_count) OR owned_count < :max',
          ExpressionAttributeValues: { ':entity': 'GROUP_OWNER_COUNTER', ':now': now, ':one': 1, ':max': MAX_OWNED_GROUPS },
        },
      },
      { Put: { TableName: GROUPS_TABLE, Item: group, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: GROUPS_TABLE, Item: ownerMembership, ConditionExpression: 'attribute_not_exists(PK)' } },
    ]);
    return success({ group: { ...publicGroup(group), role: 'owner', members: [publicMember(ownerMembership)], tasks: [] } }, 201);
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error(`You can own at most ${MAX_OWNED_GROUPS} groups`, 409);
    console.error('Error creating group:', err);
    return error('Failed to create group', 500);
  }
};

exports.getGroup = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    if (!userId) return error('Unauthorized', 401);
    if (!groupId) return error('Missing groupId parameter', 400);
    const currentMember = await requireMember(groupId, userId);
    if (!currentMember) return error('Group not found', 404);
    const items = await queryTable(GROUPS_TABLE, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `GROUP#${groupId}` },
    });
    const group = items.find((item) => item.SK === 'GROUP' && !item.deleting);
    if (!group) return error('Group not found', 404);
    const members = items.filter((item) => item.entity_type === 'GROUP_MEMBER' && !item.removing).map(publicMember);
    const tasks = items
      .filter((item) => item.entity_type === 'GROUP_TASK')
      .map(publicTask)
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
    return success({ group: { ...publicGroup(group), role: currentMember.role, members, tasks } });
  } catch (err) {
    console.error('Error loading group:', err);
    return error('Failed to load group', 500);
  }
};

exports.inviteMember = async (event) => {
  const genericResponse = () => success({ message: 'If that account can be invited, an invitation is now waiting for them.' }, 202);
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    if (!userId) return error('Unauthorized', 401);
    if (!groupId) return error('Missing groupId parameter', 400);
    const requester = await requireMember(groupId, userId);
    if (!requester) return error('Group not found', 404);
    if (requester.role !== 'owner') return error('Only the group owner can invite members', 403);

    const body = parseBody(event);
    const emailResult = validatedText(body?.email, 'Email', 254, true);
    if (emailResult.error || !/^\S+@\S+\.\S+$/.test(emailResult.value)) return error('Enter a valid member email', 400);
    const emailNormalized = emailResult.value.toLowerCase();
    const groupItems = await queryTable(GROUPS_TABLE, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `GROUP#${groupId}` },
      ConsistentRead: true,
    });
    const group = groupItems.find((item) => item.SK === 'GROUP' && !item.deleting);
    if (!group) return error('Group not found', 404);

    let profiles = await queryTable(USERS_TABLE, {
      IndexName: 'EmailNormalizedIndex',
      KeyConditionExpression: 'email_normalized = :email',
      ExpressionAttributeValues: { ':email': emailNormalized },
      Limit: 1,
    });
    if (!profiles.length) {
      profiles = await queryTable(USERS_TABLE, {
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': emailResult.value },
        Limit: 1,
      });
    }
    if (!profiles.length) {
      const legacyProfiles = await scanTable(USERS_TABLE, {
        ProjectionExpression: 'user_id, #email, display_name, full_name',
        ExpressionAttributeNames: { '#email': 'email' },
      });
      profiles = legacyProfiles.filter((item) => String(item.email || '').trim().toLowerCase() === emailNormalized).slice(0, 1);
    }
    const profile = profiles[0];
    const eligibleProfile = profile
      && profile.user_id !== userId
      && !groupItems.some((item) => item.SK === `MEMBER#${profile.user_id}`);
    const now = timestamp();
    const key = invitationKey(groupId, emailNormalized);
    const invitation = {
      ...key,
      entity_type: eligibleProfile ? 'GROUP_INVITE' : 'GROUP_INVITE_ATTEMPT',
      group_id: groupId,
      owner_id: group.owner_id,
      invited_by: userId,
      created_at: now,
      ...(eligibleProfile ? {
        GSI1PK: `USER#${profile.user_id}`,
        GSI1SK: `INVITE#${now}#${groupId}`,
        group_name: group.name,
        group_description: group.description || '',
        group_color: group.color,
        target_user_id: profile.user_id,
        target_display_name: String(profile.display_name || profile.full_name || 'Member').slice(0, 120),
        invited_by_name: requester.display_name,
      } : {}),
    };
    await transactWrite([
      membershipCondition(groupId, userId, 'owner'),
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          UpdateExpression: 'SET updated_at = :now ADD people_count :one',
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting) AND people_count < :max',
          ExpressionAttributeValues: { ':now': now, ':one': 1, ':max': MAX_GROUP_MEMBERS },
        },
      },
      { Put: { TableName: GROUPS_TABLE, Item: invitation, ConditionExpression: 'attribute_not_exists(PK)' } },
    ]);
    return genericResponse();
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return genericResponse();
    console.error('Error inviting group member:', err);
    return error('Failed to send invitation', 500);
  }
};

exports.acceptInvitation = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    if (!userId) return error('Unauthorized', 401);
    const invitation = await recipientInvitation(groupId, userId);
    const group = await groupRecord(groupId);
    if (!invitation || invitation.target_user_id !== userId || !group || group.deleting) return error('Invitation not found', 404);
    const now = timestamp();
    const memberItem = {
      PK: `GROUP#${groupId}`,
      SK: `MEMBER#${userId}`,
      entity_type: 'GROUP_MEMBER',
      GSI1PK: `USER#${userId}`,
      GSI1SK: `GROUP#${now}#${groupId}`,
      group_id: groupId,
      group_name: group.name,
      group_description: group.description || '',
      group_color: group.color,
      owner_id: group.owner_id,
      user_id: userId,
      display_name: invitation.target_display_name,
      role: 'member',
      joined_at: now,
    };
    await transactWrite([
      activeGroupCondition(groupId),
      { Put: { TableName: GROUPS_TABLE, Item: memberItem, ConditionExpression: 'attribute_not_exists(PK)' } },
      {
        Delete: {
          TableName: GROUPS_TABLE,
          Key: { PK: invitation.PK, SK: invitation.SK },
          ConditionExpression: 'target_user_id = :userId',
          ExpressionAttributeValues: { ':userId': userId },
        },
      },
    ]);
    return success({ group: { ...publicGroup(group), role: 'member' } });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error('Invitation is no longer available', 409);
    console.error('Error accepting invitation:', err);
    return error('Failed to accept invitation', 500);
  }
};

exports.declineInvitation = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    if (!userId) return error('Unauthorized', 401);
    const requester = await requireMember(groupId, userId);
    if (requester?.role === 'owner') {
      const items = await queryTable(GROUPS_TABLE, {
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :invite)',
        ExpressionAttributeValues: { ':pk': `GROUP#${groupId}`, ':invite': 'INVITE#' },
        ConsistentRead: true,
      });
      if (!items.length) return success({ message: 'Pending invitations cleared' });
      const transaction = [
        membershipCondition(groupId, userId, 'owner'),
        {
          Update: {
            TableName: GROUPS_TABLE,
            Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
            UpdateExpression: 'SET updated_at = :now ADD people_count :decrement',
            ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting) AND people_count >= :count',
            ExpressionAttributeValues: { ':now': timestamp(), ':decrement': -items.length, ':count': items.length },
          },
        },
        ...items.map((item) => ({
          Delete: {
            TableName: GROUPS_TABLE,
            Key: { PK: item.PK, SK: item.SK },
            ConditionExpression: 'entity_type = :invite OR entity_type = :attempt',
            ExpressionAttributeValues: { ':invite': 'GROUP_INVITE', ':attempt': 'GROUP_INVITE_ATTEMPT' },
          },
        })),
      ];
      await transactWrite(transaction);
      return success({ message: 'Pending invitations cleared' });
    }
    const invitation = await recipientInvitation(groupId, userId);
    if (!invitation) return error('Invitation not found', 404);
    await transactWrite([
      {
        Delete: {
          TableName: GROUPS_TABLE,
          Key: { PK: invitation.PK, SK: invitation.SK },
          ConditionExpression: 'target_user_id = :userId',
          ExpressionAttributeValues: { ':userId': userId },
        },
      },
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          UpdateExpression: 'SET updated_at = :now ADD people_count :minusOne',
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting) AND people_count > :zero',
          ExpressionAttributeValues: { ':now': timestamp(), ':minusOne': -1, ':zero': 0 },
        },
      },
    ]);
    return success({ message: 'Invitation declined' });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error('Invitation not found or group changed', 404);
    console.error('Error declining invitation:', err);
    return error('Failed to decline invitation', 500);
  }
};

exports.removeMember = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    const memberId = event.pathParameters?.memberId;
    if (!userId) return error('Unauthorized', 401);
    if (!groupId || !memberId) return error('Missing member parameter', 400);
    const requester = await requireMember(groupId, userId);
    const target = await membership(groupId, memberId);
    if (!requester) return error('Group not found', 404);
    if (!target) return error('Member not found', 404);
    if (target.role === 'owner') return error('Delete the group or transfer ownership before the owner can leave', 409);
    if (requester.role !== 'owner' && memberId !== userId) return error('You cannot remove this member', 403);

    const markTransaction = [];
    if (memberId !== userId) markTransaction.push(membershipCondition(groupId, userId, 'owner'));
    markTransaction.push({
      Update: {
        TableName: GROUPS_TABLE,
        Key: memberKey(groupId, memberId),
        UpdateExpression: 'SET removing = :true, updated_at = :now',
        ConditionExpression: '#role = :member',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':true': true, ':now': timestamp(), ':member': 'member' },
      },
    });
    await transactWrite(markTransaction);

    const tasks = await queryTable(GROUPS_TABLE, {
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :task)',
      ExpressionAttributeValues: { ':pk': `GROUP#${groupId}`, ':task': 'TASK#' },
      ConsistentRead: true,
    });
    const assignedTasks = tasks.filter((task) => task.assigned_to === memberId);
    for (let index = 0; index < assignedTasks.length; index += 100) {
      const chunk = assignedTasks.slice(index, index + 100);
      await transactWrite(chunk.map((task) => ({
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: task.PK, SK: task.SK },
          UpdateExpression: 'SET assigned_to = :none, updated_at = :now',
          ConditionExpression: 'assigned_to = :memberId AND entity_type = :entity',
          ExpressionAttributeValues: { ':none': null, ':now': timestamp(), ':memberId': memberId, ':entity': 'GROUP_TASK' },
        },
      })));
    }
    await transactWrite([
      {
        Delete: {
          TableName: GROUPS_TABLE,
          Key: memberKey(groupId, memberId),
          ConditionExpression: 'removing = :true AND #role = :member',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: { ':true': true, ':member': 'member' },
        },
      },
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          UpdateExpression: 'SET updated_at = :now ADD people_count :minusOne',
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting) AND people_count > :zero',
          ExpressionAttributeValues: { ':now': timestamp(), ':minusOne': -1, ':zero': 0 },
        },
      },
    ]);
    return success({ message: memberId === userId ? 'You left the group' : 'Member removed' });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error('Membership changed. Refresh and try again.', 409);
    console.error('Error removing group member:', err);
    return error('Failed to remove member', 500);
  }
};

exports.deleteGroup = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    if (!userId) return error('Unauthorized', 401);
    const requester = await requireMember(groupId, userId);
    if (!requester) return error('Group not found', 404);
    if (requester.role !== 'owner') return error('Only the group owner can delete the group', 403);
    await transactWrite([
      membershipCondition(groupId, userId, 'owner'),
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          UpdateExpression: 'SET deleting = :true, updated_at = :now',
          ConditionExpression: 'owner_id = :userId',
          ExpressionAttributeValues: { ':true': true, ':now': timestamp(), ':userId': userId },
        },
      },
    ]);
    const items = await queryTable(GROUPS_TABLE, {
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `GROUP#${groupId}` },
      ConsistentRead: true,
    });
    const retainedKeys = new Set(['GROUP', `MEMBER#${userId}`]);
    const cleanup = items
      .filter((item) => !retainedKeys.has(item.SK))
      .map((item) => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } }));
    await batchWriteTable(GROUPS_TABLE, cleanup);
    await transactWrite([
      {
        Delete: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          ConditionExpression: 'owner_id = :userId AND deleting = :true',
          ExpressionAttributeValues: { ':userId': userId, ':true': true },
        },
      },
      {
        Delete: {
          TableName: GROUPS_TABLE,
          Key: memberKey(groupId, userId),
          ConditionExpression: '#role = :owner',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: { ':owner': 'owner' },
        },
      },
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `USER#${userId}`, SK: 'OWNED_GROUPS' },
          UpdateExpression: 'SET owned_count = if_not_exists(owned_count, :one) - :one, updated_at = :now',
          ExpressionAttributeValues: { ':one': 1, ':now': timestamp() },
        },
      },
    ]);
    return success({ message: 'Group deleted' });
  } catch (err) {
    console.error('Error deleting group:', err);
    return error('Failed to delete group', 500);
  }
};

exports.createTask = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    if (!userId) return error('Unauthorized', 401);
    const currentMember = await requireMember(groupId, userId);
    if (!currentMember) return error('Group not found', 404);
    const body = parseBody(event);
    if (!body) return error('Invalid JSON body', 400);
    const titleResult = validatedText(body.title, 'Task title', 200, true);
    const descriptionResult = validatedText(body.description, 'Description', 2000);
    if (titleResult.error) return error(titleResult.error, 400);
    if (descriptionResult.error) return error(descriptionResult.error, 400);
    const deadline = new Date(body.deadline);
    if (!body.deadline || Number.isNaN(deadline.getTime())) return error('A valid deadline is required', 400);

    const assignedTo = body.assigned_to || null;
    const taskId = generateId();
    const now = timestamp();
    const task = {
      PK: `GROUP#${groupId}`,
      SK: `TASK#${taskId}`,
      entity_type: 'GROUP_TASK',
      group_id: groupId,
      task_id: taskId,
      title: titleResult.value,
      description: descriptionResult.value,
      deadline: deadline.toISOString(),
      status: 'not_started',
      progress_percentage: 0,
      assigned_to: assignedTo,
      created_by: userId,
      created_by_name: currentMember.display_name,
      created_at: now,
      updated_at: now,
    };
    const transaction = [
      membershipCondition(groupId, userId),
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          UpdateExpression: 'SET updated_at = :now ADD task_count :one',
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting) AND task_count < :max',
          ExpressionAttributeValues: { ':now': now, ':one': 1, ':max': MAX_GROUP_TASKS },
        },
      },
    ];
    if (assignedTo && assignedTo !== userId) transaction.push(membershipCondition(groupId, assignedTo));
    transaction.push({ Put: { TableName: GROUPS_TABLE, Item: task, ConditionExpression: 'attribute_not_exists(PK)' } });
    await transactWrite(transaction);
    return success({ task: publicTask(task) }, 201);
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error('Group membership changed. Refresh and try again.', 409);
    console.error('Error creating group task:', err);
    return error('Failed to create group task', 500);
  }
};

function transactionUpdate(groupId, taskId, updates, taskCondition, taskConditionValues, membershipCheck, assigneeCheck) {
  const names = {};
  const values = { ':entity': 'GROUP_TASK', ...taskConditionValues };
  const sets = [];
  Object.entries(updates).forEach(([field, value], index) => {
    names[`#u${index}`] = field;
    values[`:u${index}`] = value;
    sets.push(`#u${index} = :u${index}`);
  });
  const transaction = [membershipCheck, activeGroupCondition(groupId)];
  if (assigneeCheck) transaction.push(assigneeCheck);
  transaction.push({
    Update: {
      TableName: GROUPS_TABLE,
      Key: { PK: `GROUP#${groupId}`, SK: `TASK#${taskId}` },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: `attribute_exists(PK) AND entity_type = :entity${taskCondition ? ` AND (${taskCondition})` : ''}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    },
  });
  return transaction;
}

exports.updateTask = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    const taskId = event.pathParameters?.taskId;
    if (!userId) return error('Unauthorized', 401);
    const currentMember = await requireMember(groupId, userId);
    if (!currentMember) return error('Group not found', 404);
    const existing = await getItem(GROUPS_TABLE, { PK: `GROUP#${groupId}`, SK: `TASK#${taskId}` });
    if (!existing || existing.entity_type !== 'GROUP_TASK') return error('Task not found', 404);
    const body = parseBody(event);
    if (!body) return error('Invalid JSON body', 400);

    const canManage = currentMember.role === 'owner' || existing.created_by === userId;
    const canProgress = canManage || existing.assigned_to === userId;
    if (!canProgress) return error('You cannot update this task', 403);
    const updates = { updated_at: timestamp() };
    if (body.status !== undefined) {
      if (!TASK_STATUSES.has(body.status)) return error('Invalid task status', 400);
      updates.status = body.status;
      if (body.status === 'completed') updates.progress_percentage = 100;
      else if (body.status === 'not_started') updates.progress_percentage = 0;
      else updates.progress_percentage = Math.min(99, Math.max(1, Number(body.progress_percentage ?? existing.progress_percentage) || 1));
    } else if (body.progress_percentage !== undefined) {
      const progress = Number(body.progress_percentage);
      if (!Number.isFinite(progress) || progress < 0 || progress > 100) return error('Progress must be between 0 and 100', 400);
      updates.progress_percentage = progress;
      updates.status = progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started';
    }

    const managementFields = ['title', 'description', 'deadline', 'assigned_to'];
    if (managementFields.some((field) => body[field] !== undefined) && !canManage) return error('Only the owner or task creator can edit task details', 403);
    if (body.title !== undefined) {
      const result = validatedText(body.title, 'Task title', 200, true);
      if (result.error) return error(result.error, 400);
      updates.title = result.value;
    }
    if (body.description !== undefined) {
      const result = validatedText(body.description, 'Description', 2000);
      if (result.error) return error(result.error, 400);
      updates.description = result.value;
    }
    if (body.deadline !== undefined) {
      const deadline = new Date(body.deadline);
      if (Number.isNaN(deadline.getTime())) return error('Invalid deadline', 400);
      updates.deadline = deadline.toISOString();
    }
    let assigneeCheck;
    if (body.assigned_to !== undefined) {
      updates.assigned_to = body.assigned_to || null;
      if (body.assigned_to && body.assigned_to !== userId) assigneeCheck = membershipCondition(groupId, body.assigned_to);
    }
    if (Object.keys(updates).length === 1) return error('No fields to update', 400);

    const membershipCheck = membershipCondition(groupId, userId, currentMember.role === 'owner' ? 'owner' : undefined);
    let taskCondition = '';
    let taskConditionValues = {};
    if (currentMember.role !== 'owner') {
      taskCondition = canManage ? 'created_by = :userId' : 'assigned_to = :userId';
      taskConditionValues = { ':userId': userId };
    }
    await transactWrite(transactionUpdate(groupId, taskId, updates, taskCondition, taskConditionValues, membershipCheck, assigneeCheck));
    const updated = await getItem(GROUPS_TABLE, { PK: `GROUP#${groupId}`, SK: `TASK#${taskId}` });
    return success({ task: publicTask(updated) });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error('Task or membership changed. Refresh and try again.', 409);
    console.error('Error updating group task:', err);
    return error('Failed to update group task', 500);
  }
};

exports.deleteTask = async (event) => {
  try {
    const userId = getUserId(event);
    const groupId = event.pathParameters?.groupId;
    const taskId = event.pathParameters?.taskId;
    if (!userId) return error('Unauthorized', 401);
    const currentMember = await requireMember(groupId, userId);
    if (!currentMember) return error('Group not found', 404);
    const existing = await getItem(GROUPS_TABLE, { PK: `GROUP#${groupId}`, SK: `TASK#${taskId}` });
    if (!existing || existing.entity_type !== 'GROUP_TASK') return error('Task not found', 404);
    if (currentMember.role !== 'owner' && existing.created_by !== userId) return error('You cannot delete this task', 403);
    const taskCondition = currentMember.role === 'owner'
      ? 'attribute_exists(PK) AND entity_type = :entity'
      : 'attribute_exists(PK) AND entity_type = :entity AND created_by = :userId';
    await transactWrite([
      membershipCondition(groupId, userId, currentMember.role === 'owner' ? 'owner' : undefined),
      {
        Update: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: 'GROUP' },
          UpdateExpression: 'SET updated_at = :now ADD task_count :minusOne',
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deleting) AND task_count > :zero',
          ExpressionAttributeValues: { ':now': timestamp(), ':minusOne': -1, ':zero': 0 },
        },
      },
      {
        Delete: {
          TableName: GROUPS_TABLE,
          Key: { PK: `GROUP#${groupId}`, SK: `TASK#${taskId}` },
          ConditionExpression: taskCondition,
          ExpressionAttributeValues: currentMember.role === 'owner'
            ? { ':entity': 'GROUP_TASK' }
            : { ':entity': 'GROUP_TASK', ':userId': userId },
        },
      },
    ]);
    return success({ message: 'Task deleted' });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') return error('Task or membership changed. Refresh and try again.', 409);
    console.error('Error deleting group task:', err);
    return error('Failed to delete group task', 500);
  }
};

exports.handler = async (event) => {
  const method = event.httpMethod;
  const resource = event.resource || '';
  if (resource === '/groups' && method === 'GET') return exports.listGroups(event);
  if (resource === '/groups' && method === 'POST') return exports.createGroup(event);
  if (resource === '/groups/{groupId}' && method === 'GET') return exports.getGroup(event);
  if (resource === '/groups/{groupId}' && method === 'DELETE') return exports.deleteGroup(event);
  if (resource === '/groups/{groupId}/members' && method === 'POST') return exports.inviteMember(event);
  if (resource === '/groups/{groupId}/members/{memberId}' && method === 'DELETE') return exports.removeMember(event);
  if (resource === '/groups/{groupId}/invitations/accept' && method === 'POST') return exports.acceptInvitation(event);
  if (resource === '/groups/{groupId}/invitations' && method === 'DELETE') return exports.declineInvitation(event);
  if (resource === '/groups/{groupId}/tasks' && method === 'POST') return exports.createTask(event);
  if (resource === '/groups/{groupId}/tasks/{taskId}' && method === 'PUT') return exports.updateTask(event);
  if (resource === '/groups/{groupId}/tasks/{taskId}' && method === 'DELETE') return exports.deleteTask(event);
  return error('Route not found', 404);
};
