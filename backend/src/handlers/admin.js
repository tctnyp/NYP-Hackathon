const { CognitoIdentityProviderClient, ListUsersCommand, AdminGetUserCommand, AdminEnableUserCommand, AdminDisableUserCommand, AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand, AdminListGroupsForUserCommand, ListUsersInGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { success, error, getUserId, getUsername, isAdmin, parseBody } = require('../utils/response');

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.REGION || 'us-east-1' });
const USER_POOL_ID = process.env.USER_POOL_ID;

/**
 * GET /admin/users
 * List all Cognito users (admin only)
 */
exports.listUsers = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);

    if (!isAdmin(event)) {
      return error('Forbidden: Admins group membership required', 403);
    }

    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit) || 60, 60);
    const paginationToken = queryParams.paginationToken || undefined;

    const command = new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: limit,
      PaginationToken: paginationToken,
    });

    const response = await cognitoClient.send(command);

    const users = await Promise.all(response.Users.map(async (user) => {
      const attributes = {};
      user.Attributes.forEach(attr => {
        attributes[attr.Name] = attr.Value;
      });

      // Fetch actual groups for this user
      let groups = [];
      try {
        const groupsCommand = new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: user.Username,
        });
        const groupsResponse = await cognitoClient.send(groupsCommand);
        groups = (groupsResponse.Groups || []).map(g => g.GroupName);
      } catch (err) {
        console.error(`Failed to fetch groups for ${user.Username}:`, err.message);
      }

      return {
        username: user.Username,
        email: attributes.email,
        email_verified: attributes.email_verified === 'true',
        name: attributes.name,
        sub: attributes.sub,
        enabled: user.Enabled,
        status: user.UserStatus,
        groups: groups,
        created: user.UserCreateDate,
        modified: user.UserLastModifiedDate,
      };
    }));

    return success({
      users,
      nextToken: response.PaginationToken || null,
      count: users.length,
    });
  } catch (err) {
    console.error('Error listing users:', err);
    return error('Failed to list users', 500, err.message);
  }
};

/**
 * PATCH /admin/users/{username}
 * Enable/disable users or add/remove from Admins group (admin only)
 */
exports.manageUser = async (event) => {
  try {
    const userId = getUserId(event);
    const currentUsername = getUsername(event);
    if (!userId) return error('Unauthorized', 401);

    if (!isAdmin(event)) {
      return error('Forbidden: Admins group membership required', 403);
    }

    const username = event.pathParameters?.username;
    if (!username) {
      return error('Username path parameter required', 400);
    }

    const body = parseBody(event);
    if (!body) {
      return error('Invalid JSON body', 400);
    }

    const { action, group } = body;

    if (!action) {
      return error('action field required (enable, disable, addToGroup, removeFromGroup)', 400);
    }

    // Validate admin cannot disable self
    if (action === 'disable' && username === currentUsername) {
      return error('Cannot disable your own account', 403);
    }

    // Validate admin cannot remove own Admins membership
    if (action === 'removeFromGroup' && group === 'Admins' && username === currentUsername) {
      return error('Cannot remove your own Admins membership', 403);
    }

    // If removing from Admins group, ensure at least one admin remains
    if (action === 'removeFromGroup' && group === 'Admins') {
      try {
        const adminsCommand = new ListUsersInGroupCommand({
          UserPoolId: USER_POOL_ID,
          GroupName: 'Admins',
        });
        const adminsResponse = await cognitoClient.send(adminsCommand);
        if (adminsResponse.Users && adminsResponse.Users.length <= 1) {
          return error('Cannot remove the final admin. At least one admin must remain.', 403);
        }
      } catch (err) {
        console.error('Failed to check admin count:', err.message);
        return error('Could not verify that another admin would remain', 503);
      }
    }

    let result = {};

    switch (action) {
      case 'enable':
        await cognitoClient.send(new AdminEnableUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        }));
        result.message = `User ${username} enabled`;
        break;

      case 'disable':
        await cognitoClient.send(new AdminDisableUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
        }));
        result.message = `User ${username} disabled`;
        break;

      case 'addToGroup':
        if (!group) {
          return error('group field required for addToGroup action', 400);
        }
        if (group !== 'Admins') {
          return error('Only Admins group is currently supported', 400);
        }
        await cognitoClient.send(new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: group,
        }));
        result.message = `User ${username} added to ${group} group`;
        break;

      case 'removeFromGroup':
        if (!group) {
          return error('group field required for removeFromGroup action', 400);
        }
        if (group !== 'Admins') {
          return error('Only Admins group is currently supported', 400);
        }
        await cognitoClient.send(new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: group,
        }));
        result.message = `User ${username} removed from ${group} group`;
        break;

      default:
        return error('Invalid action. Must be: enable, disable, addToGroup, or removeFromGroup', 400);
    }

    // Fetch updated user details with real groups
    const userCommand = new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    });
    const userResponse = await cognitoClient.send(userCommand);

    const attributes = {};
    userResponse.UserAttributes.forEach(attr => {
      attributes[attr.Name] = attr.Value;
    });

    // Fetch actual groups
    let groups = [];
    try {
      const groupsCommand = new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      });
      const groupsResponse = await cognitoClient.send(groupsCommand);
      groups = (groupsResponse.Groups || []).map(g => g.GroupName);
    } catch (err) {
      console.error(`Failed to fetch groups for ${username}:`, err.message);
    }

    result.user = {
      username: userResponse.Username,
      email: attributes.email,
      enabled: userResponse.Enabled,
      status: userResponse.UserStatus,
      groups: groups,
    };

    return success(result);
  } catch (err) {
    console.error('Error managing user:', err);
    if (err.name === 'UserNotFoundException') {
      return error('User not found', 404);
    }
    return error('Failed to manage user', 500, err.message);
  }
};
