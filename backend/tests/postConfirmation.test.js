const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  class PutCommand {
    constructor(input) { this.input = input; }
  }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand,
  };
});

process.env.USERS_TABLE = 'users-test';

const postConfirmation = require('../src/handlers/postConfirmation');

function event(triggerSource) {
  return {
    triggerSource,
    userName: 'student',
    request: {
      userAttributes: {
        sub: 'user-123',
        email: 'Student@Example.com',
        name: 'Student Name',
      },
    },
  };
}

describe('postConfirmation onboarding eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  test('marks a genuinely confirmed signup for the first-login walkthrough', async () => {
    const sourceEvent = event('PostConfirmation_ConfirmSignUp');
    await expect(postConfirmation.handler(sourceEvent)).resolves.toBe(sourceEvent);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual(expect.objectContaining({
      TableName: 'users-test',
      ConditionExpression: 'attribute_not_exists(user_id)',
      Item: expect.objectContaining({
        user_id: 'user-123',
        email_normalized: 'student@example.com',
        preferences: { onboarding_required: true },
      }),
    }));
  });

  test('does not mark a non-signup confirmation event as first login', async () => {
    const sourceEvent = event('PostConfirmation_ConfirmForgotPassword');
    await expect(postConfirmation.handler(sourceEvent)).resolves.toBe(sourceEvent);

    expect(mockSend.mock.calls[0][0].input.Item.preferences).toEqual({});
  });
});
