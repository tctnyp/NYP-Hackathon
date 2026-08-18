const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const USERS_TABLE = process.env.USERS_TABLE;

/**
 * Cognito PostConfirmation trigger
 * Creates a non-administrator user profile after confirmation
 */
exports.handler = async (event) => {
  console.log('PostConfirmation trigger invoked for user:', event.userName);

  try {
    const { sub, email, name, identities } = event.request.userAttributes;

    if (!sub || !email) {
      console.error('Missing required attributes: sub or email');
      return event; // Don't block user confirmation
    }

    const now = new Date().toISOString();

    // Create user profile
    const profileCommand = new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        user_id: sub,
        email: email,
        full_name: name || email.split('@')[0] || 'User',
        organization_id: null,
        school_id: null,
        class_id: null,
        preferences: {},
        role: 'user',
        auth_provider: identities ? 'federated' : 'cognito',
        created_at: now,
        updated_at: now,
      },
      ConditionExpression: 'attribute_not_exists(user_id)', // Don't overwrite existing profile
    });

    try {
      await docClient.send(profileCommand);
      console.log('User profile created:', sub);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log('Profile already exists for user:', sub);
      } else {
        console.error('Error creating profile:', err.message);
        // Don't block confirmation
      }
    }

    return event;
  } catch (err) {
    console.error('PostConfirmation trigger error:', err.message);
    // Return event to avoid blocking user confirmation
    return event;
  }
};
