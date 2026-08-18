const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class MockCommand {
    constructor(input) {
      this.input = input;
    }
  }
  return {
    AdminDisableUserCommand: MockCommand,
    AdminEnableUserCommand: MockCommand,
    AdminGetUserCommand: MockCommand,
    AdminListGroupsForUserCommand: MockCommand,
    CognitoIdentityProviderClient: jest.fn(() => ({ send: mockSend })),
    ListUsersCommand: MockCommand,
  };
}, { virtual: true });

process.env.USER_POOL_ID = 'pool-test';
process.env.ADMIN_USERNAME = 'admin';

const admin = require('../src/handlers/admin');

function event(username, action = 'disable') {
  return {
    body: JSON.stringify({ action }),
    pathParameters: { username },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'admin-sub',
          'cognito:username': 'admin',
          'cognito:groups': '[Admins]',
        },
      },
    },
  };
}

describe('immutable sole administrator management', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(['admin', 'Admin', 'ADMIN', 'aDmIn'])(
    'rejects disabling case variant %s without calling Cognito',
    async (username) => {
      const response = await admin.manageUser(event(username));
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toMatch(/sole administrator/i);
      expect(mockSend).not.toHaveBeenCalled();
    },
  );

  test('still rejects group mutation actions', async () => {
    const response = await admin.manageUser(event('student', 'addToGroup'));
    expect(response.statusCode).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
