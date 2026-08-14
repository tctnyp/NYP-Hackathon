const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');

const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.REGION || 'us-east-1' });

const USERS_TABLE = process.env.USERS_TABLE;
const BOOTSTRAP_MARKER_KEY = 'BOOTSTRAP#FIRST_ADMIN';

/**
 * Cognito PostConfirmation trigger
 * Creates user profile and grants first confirmed user Admins group
 */
exports.handler = async (event) => {
  console.log('PostConfirmation trigger invoked for user:', event.userName);

  try {
    const { userPoolId, userName } = event;
    const { sub, email, name } = event.request.userAttributes;

    if (!sub || !email) {
      console.error('Missing required attributes: sub or email');
      return event; // Don't block user confirmation
    }

    const now = new Date().toISOString();

    // Check if this is the first user by attempting to create a bootstrap marker
    let isFirstUser = false;
    let markerAcquired = false;
    try {
      const markerCommand = new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          user_id: BOOTSTRAP_MARKER_KEY,
          first_admin_username: userName,
          first_admin_sub: sub,
          created_at: now,
        },
        ConditionExpression: 'attribute_not_exists(user_id)', // Only succeeds if marker doesn't exist
      });
      await docClient.send(markerCommand);
      isFirstUser = true;
      markerAcquired = true;
      console.log('First user detected, will grant Admins group');
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log('Not the first user (bootstrap marker already exists)');
      } else {
        console.error('Error checking bootstrap marker:', err.message);
        // Don't block user confirmation on this error
      }
    }

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
        auth_provider: 'cognito',
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

    // If first user, add to Admins group
    if (isFirstUser) {
      try {
        const addToGroupCommand = new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId, // Get from event, not environment variable
          Username: userName,
          GroupName: 'Admins',
        });
        await cognitoClient.send(addToGroupCommand);
        console.log('First user added to Admins group:', userName);

        try {
          await docClient.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { user_id: sub },
            UpdateExpression: 'SET #role = :role, updated_at = :updatedAt',
            ExpressionAttributeNames: { '#role': 'role' },
            ExpressionAttributeValues: { ':role': 'admin', ':updatedAt': new Date().toISOString() },
          }));
        } catch (profileUpdateError) {
          console.error('Failed to update admin profile role:', profileUpdateError.message);
        }
      } catch (err) {
        console.error('Error adding first user to Admins group:', err.message);

        // If we acquired the marker but failed to assign admin, clean up marker
        if (markerAcquired) {
          try {
            await docClient.send(new DeleteCommand({
              TableName: USERS_TABLE,
              Key: { user_id: BOOTSTRAP_MARKER_KEY },
            }));
            console.log('Bootstrap marker released due to admin assignment failure');
          } catch (deleteErr) {
            console.error('Failed to release bootstrap marker:', deleteErr.message);
          }
        }
        // Don't block confirmation but log the error
      }
    }

    return event;
  } catch (err) {
    console.error('PostConfirmation trigger error:', err.message);
    // Return event to avoid blocking user confirmation
    return event;
  }
};
