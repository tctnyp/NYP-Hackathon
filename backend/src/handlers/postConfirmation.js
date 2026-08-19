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
    const { sub, email, name, identities, preferred_username: preferredUsername } = event.request.userAttributes;

    if (!sub || !email) {
      console.error('Missing required attributes: sub or email');
      return event; // Don't block user confirmation
    }

    const now = new Date().toISOString();
    const onboardingRequired = event.triggerSource === 'PostConfirmation_ConfirmSignUp';
    let discordIdentity = null;
    if (typeof identities === 'string' && identities.trim()) {
      try {
        const parsed = JSON.parse(identities);
        discordIdentity = Array.isArray(parsed)
          ? parsed.find((identity) => (
            identity
            && typeof identity.providerName === 'string'
            && identity.providerName.toLowerCase() === 'discord'
            && typeof identity.userId === 'string'
            && identity.userId
          )) || null
          : null;
      } catch {
        // Cognito owns this attribute; malformed identity metadata should not block confirmation.
      }
    }
    const discordConnection = discordIdentity ? {
      provider_user_id: discordIdentity.userId,
      username: preferredUsername || name || email.split('@')[0],
      display_name: name || preferredUsername || email.split('@')[0],
      email,
      connected_at: now,
      status: 'active',
      primary: true,
      cognito_linked: false,
    } : null;

    // Create user profile
    const profileCommand = new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        user_id: sub,
        email: email,
        email_normalized: email.trim().toLowerCase(),
        full_name: name || email.split('@')[0] || 'User',
        organization_id: null,
        school_id: null,
        class_id: null,
        preferences: onboardingRequired ? { onboarding_required: true } : {},
        role: 'user',
        auth_provider: identities ? 'federated' : 'cognito',
        ...(discordConnection ? { oauth_connection_discord: discordConnection } : {}),
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
