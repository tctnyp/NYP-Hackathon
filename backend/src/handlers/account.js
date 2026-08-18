const { createHash, randomBytes } = require('node:crypto');
const {
  AdminDisableProviderForUserCommand,
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
} = require('@aws-sdk/client-cognito-identity-provider');
const { TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  docClient,
  getItem,
  putItem,
  updateItem,
  USERS_TABLE,
  timestamp,
} = require('../utils/database');
const {
  success,
  error,
  getClaims,
  getUserId,
  getUserEmail,
  getUserName,
  parseBody,
} = require('../utils/response');
const {
  MediaError,
  deleteOwnedMedia,
  promoteUpload,
  signedMediaUrl,
} = require('../utils/mediaStorage');

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.REGION || 'us-east-1' });
const USER_POOL_ID = process.env.USER_POOL_ID;
const CALENDAR_CONNECTIONS_TABLE = process.env.CALENDAR_CONNECTIONS_TABLE;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SENSITIVE_AUTH_MAX_AGE_SECONDS = 10 * 60;
const MAX_PROFILE_PICTURE_LENGTH = 200 * 1024;
const PROVIDERS = new Set(['discord', 'google']);
const INTERNAL_FIELDS = new Set([
  'oauth_state_discord',
  'oauth_state_google',
  'oauth_connection_discord',
  'oauth_connection_google',
  'oauth_link_generation_discord',
  'oauth_link_generation_google',
]);

class ProviderError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function hasRecentAuthentication(event) {
  const authTime = Number(getClaims(event).auth_time);
  if (!Number.isFinite(authTime) || authTime <= 0) return false;
  const age = Math.floor(Date.now() / 1000) - authTime;
  return age >= -60 && age <= SENSITIVE_AUTH_MAX_AGE_SECONDS;
}

function recentAuthenticationError() {
  return error('Sign in again before changing connected accounts', 403);
}

function normalizeProvider(provider) {
  if (typeof provider !== 'string') return null;
  const normalized = provider.trim().toLowerCase();
  return PROVIDERS.has(normalized) ? normalized : null;
}

function stateField(provider) {
  return `oauth_state_${provider}`;
}

function connectionField(provider) {
  return `oauth_connection_${provider}`;
}

function linkGenerationField(provider) {
  return `oauth_link_generation_${provider}`;
}

function stateHash(userId, state) {
  return createHash('sha256').update(`${userId}\0${state}`, 'utf8').digest('hex');
}

function parseIdentities(event) {
  const raw = getClaims(event).identities;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function providerIdentity(event, providerName) {
  return parseIdentities(event).find((identity) => (
    identity
    && typeof identity.providerName === 'string'
    && identity.providerName.toLowerCase() === providerName.toLowerCase()
  )) || null;
}

function googleIdentity(event) {
  return providerIdentity(event, 'Google');
}

function discordIdentity(event) {
  return providerIdentity(event, 'Discord');
}

function isProviderOrigin(event, provider) {
  const username = getClaims(event)['cognito:username'];
  return typeof username === 'string' && username.toLowerCase().startsWith(`${provider.toLowerCase()}_`);
}

function isGoogleOrigin(event) {
  return isProviderOrigin(event, 'google');
}

function isDiscordOrigin(event) {
  return isProviderOrigin(event, 'discord');
}

function cognitoDestinationUser(event) {
  let providerAttributeValue = getClaims(event)['cognito:username'];
  if (isGoogleOrigin(event)) providerAttributeValue = googleIdentity(event)?.userId;
  if (isDiscordOrigin(event)) providerAttributeValue = discordIdentity(event)?.userId;
  if (typeof providerAttributeValue !== 'string' || !providerAttributeValue) {
    throw new Error('Cognito account linking destination is unavailable');
  }
  return {
    ProviderName: 'Cognito',
    ProviderAttributeValue: providerAttributeValue,
  };
}

async function publicProfile(profile, event) {
  if (!profile) return null;

  const profilePictureKey = profile.profile_picture_key;
  const result = { ...profile };
  for (const field of INTERNAL_FIELDS) delete result[field];

  const claimEmail = getUserEmail(event);
  const claimName = getUserName(event);
  if (claimEmail) result.email = claimEmail;
  if (!result.full_name && claimName) result.full_name = claimName;
  if (!result.display_name) {
    result.display_name = result.full_name || claimName || claimEmail?.split('@')[0] || 'User';
  }
  if (profilePictureKey) {
    try {
      result.profile_picture = (await signedMediaUrl(getUserId(event), profilePictureKey, 'profile_photo')).url;
    } catch (mediaError) {
      console.error('Profile picture access failed', { category: String(mediaError?.name || 'MediaError').slice(0, 64) });
      result.profile_picture = null;
    }
  } else if (!result.profile_picture) {
    result.profile_picture = null;
  }
  return result;
}function publicConnection(connection, fallback = {}) {
  if (!connection) return { connected: false };

  return {
    connected: true,
    ...(connection.display_name ? { display_name: connection.display_name } : {}),
    ...(connection.username ? { username: connection.username } : {}),
    ...(connection.email ? { email: connection.email } : {}),
    ...(connection.connected_at ? { connected_at: connection.connected_at } : {}),
    ...fallback,
  };
}

function isProviderConfigured(provider) {
  const config = providerConfig(provider);
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

async function accountData(event, profile) {
  const claimGoogleIdentity = googleIdentity(event);
  const googleOrigin = isGoogleOrigin(event);
  const claimGoogleConnected = Boolean(claimGoogleIdentity) || googleOrigin;
  const storedGoogle = profile?.oauth_connection_google;
  const claimGoogleFallback = claimGoogleConnected ? {
    ...(getUserEmail(event) ? { email: getUserEmail(event) } : {}),
    ...(getUserName(event) ? { display_name: getUserName(event) } : {}),
  } : {};
  const google = storedGoogle
    ? publicConnection(storedGoogle)
    : (claimGoogleConnected ? publicConnection({ connected_at: null }, claimGoogleFallback) : { connected: false });

  const claimDiscordIdentity = discordIdentity(event);
  const discordOrigin = isDiscordOrigin(event);
  const claimDiscordConnected = Boolean(claimDiscordIdentity) || discordOrigin;
  const storedDiscord = profile?.oauth_connection_discord;
  const claimDiscordFallback = claimDiscordConnected ? {
    ...(getUserEmail(event) ? { email: getUserEmail(event) } : {}),
    ...(getUserName(event) ? { display_name: getUserName(event) } : {}),
  } : {};
  const discord = storedDiscord
    ? publicConnection(storedDiscord)
    : (claimDiscordConnected ? publicConnection({ connected_at: null }, claimDiscordFallback) : { connected: false });

  return {
    profile: await publicProfile(profile, event),
    connections: {
      google: {
        ...google,
        available: isProviderConfigured('google'),
        disconnect_allowed: google.connected && !googleOrigin,
      },
      discord: {
        ...discord,
        available: isProviderConfigured('discord'),
        disconnect_allowed: discord.connected && !discordOrigin,
      },
    },
    password_change_available: !googleOrigin && !discordOrigin,
  };
}

function baseProfile(event, existing = null) {
  const now = timestamp();
  const email = getUserEmail(event);
  const tokenName = getUserName(event);
  return {
    ...(existing || {}),
    user_id: getUserId(event),
    email,
    email_normalized: email?.trim().toLowerCase() || existing?.email_normalized,
    display_name: existing?.display_name || tokenName || email?.split('@')[0] || 'User',
    full_name: existing?.full_name || tokenName || 'User',
    profile_picture: existing?.profile_picture || null,
    organization_id: existing?.organization_id ?? null,
    school_id: existing?.school_id ?? null,
    class_id: existing?.class_id ?? null,
    preferences: existing?.preferences ?? {},
    auth_provider: existing?.auth_provider || (parseIdentities(event).length ? 'federated' : 'cognito'),
    created_at: existing?.created_at || now,
    updated_at: now,
  };
}

async function ensureProfile(event) {
  const userId = getUserId(event);
  const existing = await getItem(USERS_TABLE, { user_id: userId });
  if (existing) return existing;

  const profile = baseProfile(event);
  await putItem(USERS_TABLE, profile);
  return profile;
}

function validateTextField(value, field, maxLength) {
  if (typeof value !== 'string') return `${field} must be a string`;
  const trimmed = value.trim();
  if (!trimmed) return `${field} cannot be empty`;
  if (trimmed.length > maxLength) return `${field} must be ${maxLength} characters or fewer`;
  return null;
}

function validateProfileUploadKey(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 512 || !/^uploads\/[a-f0-9]{40}\/profile_photo\/[A-Za-z0-9_.-]+$/.test(value)) {
    return 'profile_picture_upload_key must reference a completed profile photo upload or be null';
  }
  return null;
}

function validateProfileUpdate(body) {
  const allowed = new Set(['display_name', 'full_name', 'profile_picture_upload_key', 'profile_picture']);
  const fields = Object.keys(body);
  const unsupported = fields.filter((field) => !allowed.has(field));
  if (unsupported.length) return `Unsupported profile field: ${unsupported[0]}`;
  if (!fields.length) return 'At least one profile field is required';

  if (Object.hasOwn(body, 'display_name')) {
    const validationError = validateTextField(body.display_name, 'display_name', 80);
    if (validationError) return validationError;
  }
  if (Object.hasOwn(body, 'full_name')) {
    const validationError = validateTextField(body.full_name, 'full_name', 200);
    if (validationError) return validationError;
  }
  if (Object.hasOwn(body, 'profile_picture')) {
    if (Object.hasOwn(body, 'profile_picture_upload_key')) return 'Specify only profile_picture_upload_key';
    if (body.profile_picture !== null) return 'profile_picture is no longer accepted; upload the resized photo first';
  }
  if (Object.hasOwn(body, 'profile_picture_upload_key')) {
    return validateProfileUploadKey(body.profile_picture_upload_key);
  }
  return null;
}

function providerConfig(provider) {
  if (provider === 'discord') {
    return {
      clientId: process.env.DISCORD_OAUTH_CLIENT_ID,
      clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
      redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI,
    };
  }
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  };
}

function authorizationUrl(provider, config, state) {
  if (provider === 'discord') {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'identify email',
      state,
      prompt: 'consent',
    }).toString();
    return url.toString();
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'consent select_account',
  }).toString();
  return url.toString();
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ProviderError('The connection provider could not be reached');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError('The connection provider returned an invalid response');
  }
  if (!response.ok) throw new ProviderError('The connection provider rejected the request');
  return data;
}

async function exchangeDiscordCode(event, code, config) {
  const token = await fetchJson('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (typeof token.access_token !== 'string') throw new ProviderError('Discord did not return an access token');

  const user = await fetchJson('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (typeof user.id !== 'string' || typeof user.username !== 'string') {
    throw new ProviderError('Discord did not return a valid user profile');
  }

  return {
    provider_user_id: user.id,
    username: user.username,
    display_name: typeof user.global_name === 'string' ? user.global_name : user.username,
    ...(typeof user.email === 'string' ? { email: user.email } : {}),
    connected_at: timestamp(),
  };
}

async function exchangeGoogleCode(event, code, config) {
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (typeof token.access_token !== 'string') throw new ProviderError('Google did not return an access token');

  const user = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const currentEmail = getUserEmail(event);
  if (typeof user.sub !== 'string' || typeof user.email !== 'string' || user.email_verified !== true) {
    throw new ProviderError('Google did not return a verified user profile');
  }
  if (!currentEmail || user.email.toLowerCase() !== currentEmail.toLowerCase()) {
    throw new ProviderError('The Google account email must match the signed-in account');
  }

  return {
    provider_user_id: user.sub,
    email: user.email,
    ...(typeof user.name === 'string' ? { display_name: user.name } : {}),
    link_version: randomBytes(16).toString('base64url'),
    status: 'active',
    connected_at: timestamp(),
  };
}

async function consumeState(userId, provider, state) {
  const expectedHash = stateHash(userId, state);

  try {
    const response = await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'REMOVE #oauth_state SET #updated_at = :updated_at',
      ConditionExpression: '#oauth_state.#state_hash = :state_hash AND #oauth_state.#expires_at >= :now',
      ExpressionAttributeNames: {
        '#oauth_state': stateField(provider),
        '#state_hash': 'state_hash',
        '#expires_at': 'expires_at',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':state_hash': expectedHash,
        ':now': Math.floor(Date.now() / 1000),
        ':updated_at': timestamp(),
      },
      ReturnValues: 'ALL_OLD',
    }));
    return response.Attributes?.[stateField(provider)] || null;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function saveConnection(userId, provider, connection, expectedGeneration) {
  try {
    const response = await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET #connection = :connection, #updated_at = :updated_at',
      ConditionExpression: '#generation = :generation AND #connection.#status = :linking AND #connection.#operation = :generation',
      ExpressionAttributeNames: {
        '#connection': connectionField(provider),
        '#generation': linkGenerationField(provider),
        '#status': 'status',
        '#operation': 'operation_generation',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':connection': connection,
        ':generation': expectedGeneration,
        ':linking': 'linking',
        ':updated_at': timestamp(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return response.Attributes;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new ProviderError('The connected-account operation changed; start authorization again');
    }
    throw err;
  }
}

async function acquireLinkOperation(userId, provider, expectedGeneration) {
  try {
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET #connection = :linking, #updated_at = :updated_at',
      ConditionExpression: '#generation = :generation AND (attribute_not_exists(#connection.#status) OR #connection.#status = :active)',
      ExpressionAttributeNames: {
        '#connection': connectionField(provider),
        '#generation': linkGenerationField(provider),
        '#status': 'status',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':generation': expectedGeneration,
        ':linking': { status: 'linking', operation_generation: expectedGeneration },
        ':active': 'active',
        ':updated_at': timestamp(),
      },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new ProviderError('The connected-account operation changed; start authorization again');
    }
    throw err;
  }
}


async function stageProviderLink(userId, provider, connection, expectedGeneration, cognitoLinkRequired) {
  const staged = {
    ...connection,
    status: 'linking',
    operation_generation: expectedGeneration,
    operation_expires_at: Math.floor(Date.now() / 1000) + 120,
    cognito_link_attempted: cognitoLinkRequired,
    ...(provider === 'discord' ? { cognito_linked: cognitoLinkRequired } : {}),
  };
  try {
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'SET #connection = :connection, #updated_at = :updated_at',
      ConditionExpression: '#generation = :generation AND #connection.#status = :linking AND #connection.#operation = :generation',
      ExpressionAttributeNames: {
        '#connection': connectionField(provider),
        '#generation': linkGenerationField(provider),
        '#status': 'status',
        '#operation': 'operation_generation',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':connection': staged,
        ':generation': expectedGeneration,
        ':linking': 'linking',
        ':updated_at': timestamp(),
      },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new ProviderError('The connected-account operation changed; start authorization again');
    }
    throw err;
  }
  return staged;
}

async function linkProviderWithCognito(event, provider, providerUserId) {
  if (!USER_POOL_ID) throw new Error('Cognito account linking is not configured');
  await cognitoClient.send(new AdminLinkProviderForUserCommand({
    UserPoolId: USER_POOL_ID,
    DestinationUser: cognitoDestinationUser(event),
    SourceUser: {
      ProviderName: provider === 'google' ? 'Google' : 'Discord',
      ProviderAttributeName: 'Cognito_Subject',
      ProviderAttributeValue: providerUserId,
    },
  }));
}

async function releaseLinkOperation(userId, provider, expectedGeneration, stagedProviderUserId = null) {
  const providerCondition = stagedProviderUserId
    ? '#connection.#provider = :provider'
    : 'attribute_not_exists(#connection.#provider)';
  try {
    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'REMOVE #connection SET #updated_at = :updated_at',
      ConditionExpression: `#connection.#status = :linking AND #connection.#generation = :generation AND ${providerCondition}`,
      ExpressionAttributeNames: {
        '#connection': connectionField(provider),
        '#status': 'status',
        '#generation': 'operation_generation',
        '#provider': 'provider_user_id',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':linking': 'linking',
        ':generation': expectedGeneration,
        ...(stagedProviderUserId ? { ':provider': stagedProviderUserId } : {}),
        ':updated_at': timestamp(),
      },
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

async function removeConnection(userId, provider) {
  const response = await docClient.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'REMOVE #connection SET #updated_at = :updated_at',
    ExpressionAttributeNames: {
      '#connection': connectionField(provider),
      '#updated_at': 'updated_at',
    },
    ExpressionAttributeValues: { ':updated_at': timestamp() },
    ReturnValues: 'ALL_NEW',
  }));
  return response.Attributes;
}

async function oauthAuthorize(event, body, profile) {
  const provider = normalizeProvider(body.provider);
  if (!provider) return error('provider must be discord or google', 400);
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();

  const config = providerConfig(provider);
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return error(`${provider} connection is not configured`, 503);
  }

  const userId = getUserId(event);
  const state = `${provider}.${randomBytes(32).toString('base64url')}`;
  const linkGeneration = randomBytes(16).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  await updateItem(USERS_TABLE, { user_id: userId }, {
    [stateField(provider)]: {
      state_hash: stateHash(userId, state),
      expires_at: expiresAt,
      link_generation: linkGeneration,
    },
    [linkGenerationField(provider)]: linkGeneration,
    updated_at: timestamp(),
  });

  return success({
    ...(await accountData(event, profile)),
    provider,
    authorization_url: authorizationUrl(provider, config, state),
    expires_at: new Date(expiresAt * 1000).toISOString(),
  });
}

async function oauthCancel(event, body) {
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();
  if (typeof body.state !== 'string' || body.state.length > 512) return error('A valid OAuth state is required', 400);
  const separator = body.state.indexOf('.');
  const provider = normalizeProvider(separator > 0 ? body.state.slice(0, separator) : null);
  if (!provider) return error('Invalid or expired OAuth state', 400);
  const consumed = await consumeState(getUserId(event), provider, body.state);
  if (!consumed?.link_generation) return error('Invalid or expired OAuth state', 400);
  return error(`${provider === 'google' ? 'Google' : 'Discord'} authorization was cancelled`, 400);
}

const DEFINITIVE_LINK_FAILURES = new Set([
  'AccessDeniedException',
  'AliasExistsException',
  'InvalidParameterException',
  'NotAuthorizedException',
  'ResourceConflictException',
  'UserNotFoundException',
]);

function publicLinkFailure(provider, callbackError) {
  const label = provider === 'google' ? 'Google' : 'Discord';
  if (['AliasExistsException', 'InvalidParameterException', 'ResourceConflictException'].includes(callbackError?.name)) {
    return new ProviderError(`This ${label} identity already has a separate sign-in profile or cannot be linked. Accounts are not automatically merged.`, 409);
  }
  if (['AccessDeniedException', 'NotAuthorizedException', 'UserNotFoundException'].includes(callbackError?.name)) {
    return new ProviderError(`${label} account linking is temporarily unavailable. Please contact support.`, 503);
  }
  return callbackError;
}
async function oauthCallback(event, body) {
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();
  if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 4096) {
    return error('A valid OAuth code is required', 400);
  }
  if (typeof body.state !== 'string' || body.state.length > 512) {
    return error('A valid OAuth state is required', 400);
  }

  const separator = body.state.indexOf('.');
  const provider = normalizeProvider(separator > 0 ? body.state.slice(0, separator) : null);
  if (!provider) return error('Invalid or expired OAuth state', 400);

  const userId = getUserId(event);
  const consumedState = await consumeState(userId, provider, body.state);
  if (!consumedState?.link_generation) {
    return error('Invalid or expired OAuth state', 400);
  }

  const config = providerConfig(provider);
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return error(`${provider} connection is not configured`, 503);
  }

  await acquireLinkOperation(userId, provider, consumedState.link_generation);
  let stagedProviderUserId = null;
  let cognitoLinkInFlight = false;
  try {
    const connection = provider === 'discord'
      ? await exchangeDiscordCode(event, body.code.trim(), config)
      : await exchangeGoogleCode(event, body.code.trim(), config);
    const cognitoLinkRequired = provider === 'discord' ? !isDiscordOrigin(event) : !isGoogleOrigin(event);
    if (cognitoLinkRequired) {
      await stageProviderLink(userId, provider, connection, consumedState.link_generation, true);
      stagedProviderUserId = connection.provider_user_id;
      cognitoLinkInFlight = true;
      await linkProviderWithCognito(event, provider, connection.provider_user_id);
      cognitoLinkInFlight = false;
    }
    const finalizedConnection = {
      ...connection,
      status: 'active',
      ...(provider === 'discord' ? { cognito_linked: cognitoLinkRequired } : {}),
    };
    const updatedProfile = await saveConnection(userId, provider, finalizedConnection, consumedState.link_generation);
    return success(await accountData(event, updatedProfile));
  } catch (callbackError) {
    const definitiveLinkFailure = cognitoLinkInFlight && DEFINITIVE_LINK_FAILURES.has(callbackError?.name);
    await releaseLinkOperation(
      userId,
      provider,
      consumedState.link_generation,
      definitiveLinkFailure ? stagedProviderUserId : null,
    );
    throw publicLinkFailure(provider, callbackError);
  }
}

async function beginDisconnect(userId, provider, connection) {
  const generation = randomBytes(16).toString('base64url');
  const unlinking = { ...(connection || {}), status: 'unlinking', disable_completed: false };
  const userUpdate = {
    TableName: USERS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'SET #generation = :generation, #connection = :connection, #updated_at = :updated_at REMOVE #oauth_state',
    ConditionExpression: 'attribute_not_exists(#connection.#status) OR #connection.#status <> :linking OR (#connection.#operation_expires_at < :now AND attribute_exists(#connection.#provider))',
    ExpressionAttributeNames: {
      '#generation': linkGenerationField(provider),
      '#connection': connectionField(provider),
      '#status': 'status',
      '#operation_expires_at': 'operation_expires_at',
      '#provider': 'provider_user_id',
      '#oauth_state': stateField(provider),
      '#updated_at': 'updated_at',
    },
    ExpressionAttributeValues: {
      ':generation': generation,
      ':connection': unlinking,
      ':linking': 'linking',
      ':now': Math.floor(Date.now() / 1000),
      ':updated_at': timestamp(),
    },
  };

  try {
    if (provider === 'google' && CALENDAR_CONNECTIONS_TABLE) {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          { Update: userUpdate },
          {
            ConditionCheck: {
              TableName: CALENDAR_CONNECTIONS_TABLE,
              Key: { user_id: userId },
              ConditionExpression: 'attribute_not_exists(#user_id)',
              ExpressionAttributeNames: { '#user_id': 'user_id' },
            },
          },
        ],
      }));
      return unlinking;
    }

    const response = await docClient.send(new UpdateCommand({ ...userUpdate, ReturnValues: 'ALL_NEW' }));
    return response.Attributes?.[connectionField(provider)] || unlinking;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException' || err.name === 'TransactionCanceledException') {
      throw new ProviderError(
        provider === 'google'
          ? 'Finish Google Calendar cleanup and any account linking operation before disconnecting Google'
          : 'Account linking is still in progress; try disconnecting again shortly',
        409,
      );
    }
    throw err;
  }
}

async function markProviderDisableComplete(userId, provider, connection) {
  const completed = { ...connection, status: 'unlinking', disable_completed: true };
  await updateItem(USERS_TABLE, { user_id: userId }, {
    [connectionField(provider)]: completed,
    updated_at: timestamp(),
  });
  return completed;
}

async function disconnect(event, body, profile) {
  const provider = normalizeProvider(body.provider);
  if (!provider) return error('provider must be discord or google', 400);
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();

  const userId = getUserId(event);
  profile = await getItem(USERS_TABLE, { user_id: userId }) || profile;

  if (provider === 'google' && isGoogleOrigin(event)) {
    return error('The primary Google sign-in cannot be disconnected', 409);
  }
  if (provider === 'discord' && isDiscordOrigin(event)) {
    return error('The primary Discord sign-in cannot be disconnected', 409);
  }

  const storedConnection = profile?.[connectionField(provider)];
  const claimIdentity = provider === 'google' ? googleIdentity(event) : discordIdentity(event);
  const providerUserId = storedConnection?.provider_user_id || claimIdentity?.userId;
  let unlinking = storedConnection;
  if (storedConnection?.status !== 'unlinking') {
    unlinking = await beginDisconnect(userId, provider, storedConnection || { provider_user_id: providerUserId });
  }

  const shouldDisableCognito = Boolean(providerUserId)
    && (provider === 'google' || unlinking?.cognito_linked === true || claimIdentity?.userId === providerUserId)
    && unlinking?.disable_completed !== true;
  if (shouldDisableCognito) {
    if (!USER_POOL_ID) throw new Error('Cognito account linking is not configured');
    try {
      await cognitoClient.send(new AdminDisableProviderForUserCommand({
        UserPoolId: USER_POOL_ID,
        User: {
          ProviderName: provider === 'google' ? 'Google' : 'Discord',
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: providerUserId,
        },
      }));
    } catch (unlinkError) {
      if (unlinkError.name !== 'ResourceNotFoundException') throw unlinkError;
    }
    unlinking = await markProviderDisableComplete(userId, provider, unlinking || { provider_user_id: providerUserId });
  }

  const updatedProfile = await removeConnection(userId, provider);
  return success(await accountData(event, updatedProfile));
}

exports.getProfile = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);

    const profile = await getItem(USERS_TABLE, { user_id: userId });
    return success(await accountData(event, profile));
  } catch (err) {
    console.error('Account retrieval failed:', err.message);
    return error('Failed to retrieve account', 500);
  }
};

exports.upsertProfile = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    if (!getUserEmail(event)) return error('Email claim missing from token', 400);

    const body = parseBody(event);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return error('Invalid JSON body', 400);
    }

    const profile = await ensureProfile(event);
    if (Object.hasOwn(body, 'action')) {
      switch (body.action) {
        case 'oauthAuthorize':
          return await oauthAuthorize(event, body, profile);
        case 'oauthCallback':
          return await oauthCallback(event, body);
        case 'oauthCancel':
          return await oauthCancel(event, body);
        case 'disconnect':
          return await disconnect(event, body, profile);
        case 'completeOnboarding': {
          const version = Number(body.version);
          if (!Number.isInteger(version) || version < 1 || version > 100) {
            return error('Invalid onboarding version', 400);
          }
          const updateResponse = await docClient.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { user_id: userId },
            UpdateExpression: 'SET #preferences.#required = :false, #preferences.#version = :version, updated_at = :updatedAt',
            ConditionExpression: 'attribute_exists(user_id) AND attribute_exists(#preferences)',
            ExpressionAttributeNames: {
              '#preferences': 'preferences',
              '#required': 'onboarding_required',
              '#version': 'onboarding_version',
            },
            ExpressionAttributeValues: {
              ':false': false,
              ':version': version,
              ':updatedAt': timestamp(),
            },
            ReturnValues: 'ALL_NEW',
          }));
          return success(await accountData(event, updateResponse.Attributes));
        }
        default:
          return error('Invalid action', 400);
      }
    }

    const validationError = validateProfileUpdate(body);
    if (validationError) return error(validationError, 400);

    const now = timestamp();
    const oldPictureKey = profile?.profile_picture_key || null;
    let nextPictureKey = oldPictureKey;
    let promotedPictureKey = null;
    const requestedPicture = Object.hasOwn(body, 'profile_picture_upload_key')
      ? body.profile_picture_upload_key
      : (Object.hasOwn(body, 'profile_picture') && body.profile_picture === null ? null : undefined);
    if (typeof requestedPicture === 'string') {
      const promoted = await promoteUpload(userId, requestedPicture, 'profile_photo');
      promotedPictureKey = promoted.objectKey;
      nextPictureKey = promoted.objectKey;
    } else if (requestedPicture === null) {
      nextPictureKey = null;
    }

    const { profile_picture: _legacyPicture, profile_picture_key: _oldPictureKey, ...profileWithoutPicture } = baseProfile(event, profile);
    const updatedProfile = {
      ...profileWithoutPicture,
      ...(Object.hasOwn(body, 'display_name') ? { display_name: body.display_name.trim() } : {}),
      ...(Object.hasOwn(body, 'full_name') ? { full_name: body.full_name.trim() } : {}),
      ...(nextPictureKey ? { profile_picture_key: nextPictureKey } : {}),
      updated_at: now,
    };
    try {
      await putItem(USERS_TABLE, updatedProfile);
    } catch (writeError) {
      if (promotedPictureKey) await deleteOwnedMedia(userId, promotedPictureKey, 'profile_photo', true).catch(() => {});
      throw writeError;
    }
    if (oldPictureKey && oldPictureKey !== nextPictureKey) {
      await deleteOwnedMedia(userId, oldPictureKey, 'profile_photo', true).catch(() => {});
    }
    return success(await accountData(event, updatedProfile));
  } catch (err) {
    console.error('Account update failed:', err.message);
    if (err instanceof ProviderError || err instanceof MediaError) return error(err.message, err.statusCode);
    if (['AliasExistsException', 'InvalidParameterException', 'ResourceConflictException'].includes(err.name)) {
      return error('The selected identity already has a separate sign-in profile or cannot be linked', 409);
    }
    return error('Failed to update account', 500);
  }
};
