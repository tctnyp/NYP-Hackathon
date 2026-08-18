const { createHash, randomBytes } = require('node:crypto');
const { TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  docClient,
  USERS_TABLE,
  timestamp,
} = require('../utils/database');
const {
  success,
  error,
  getClaims,
  getUserEmail,
  getUserId,
  parseBody,
} = require('../utils/response');
const {
  CALENDAR_CONNECTIONS_TABLE,
  CALENDAR_SCOPE,
  CalendarSyncError,
  calendarConfig,
  encryptRefreshToken,
  getConnection,
  getGoogleLinkProfile,
  isCalendarConfigured,
  setConnectionStatus,
} = require('../utils/googleCalendarSync');

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SENSITIVE_AUTH_MAX_AGE_SECONDS = 10 * 60;

class ProviderError extends Error {}

function hasRecentAuthentication(event) {
  const authTime = Number(getClaims(event).auth_time);
  if (!Number.isFinite(authTime) || authTime <= 0) return false;
  const age = Math.floor(Date.now() / 1000) - authTime;
  return age >= -60 && age <= SENSITIVE_AUTH_MAX_AGE_SECONDS;
}

function recentAuthenticationError() {
  return error('Sign in again before changing Google Calendar synchronization', 403);
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

function claimGoogleIdentity(event) {
  return parseIdentities(event).find((identity) => (
    typeof identity?.providerName === 'string'
      && identity.providerName.toLowerCase() === 'google'
      && typeof identity.userId === 'string'
  )) || null;
}

function isGoogleOrigin(event) {
  const username = getClaims(event)['cognito:username'];
  return typeof username === 'string' && username.toLowerCase().startsWith('google_');
}

function googleLink(profile, event) {
  const identity = claimGoogleIdentity(event);
  if (isGoogleOrigin(event)) {
    const username = getClaims(event)['cognito:username'];
    const originSubject = identity?.userId
      || (typeof username === 'string' ? username.slice(username.indexOf('_') + 1) : null);
    return {
      linked: Boolean(originSubject),
      primary: true,
      providerUserId: originSubject || null,
      email: getUserEmail(event) || null,
      guardField: null,
      guardValue: null,
    };
  }

  const stored = profile?.oauth_connection_google;
  const active = stored?.provider_user_id && stored.status !== 'unlinking';
  const guardField = stored?.link_version ? 'link_version' : (stored?.connected_at ? 'connected_at' : null);
  return {
    linked: Boolean(active && guardField),
    primary: false,
    providerUserId: active ? stored.provider_user_id : null,
    email: active ? stored.email : null,
    guardField,
    guardValue: guardField ? stored[guardField] : null,
  };
}

function publicCalendarStatus(record, linked) {
  const status = record?.status || 'disabled';
  return {
    linked,
    available: isCalendarConfigured(),
    enabled: record?.enabled === true && status === 'enabled',
    status,
    ...(record?.calendar_email ? { calendar_email: record.calendar_email } : {}),
    ...(record?.last_sync_at ? { last_sync_at: record.last_sync_at } : {}),
    ...(record?.last_attempt_at ? { last_attempt_at: record.last_attempt_at } : {}),
    ...(record?.last_error ? { last_error: record.last_error } : {}),
  };
}

function stateHash(userId, state) {
  return createHash('sha256').update(`${userId}\0calendar\0${state}`, 'utf8').digest('hex');
}

async function saveState(userId, state, expiresAt, link, mode) {
  await docClient.send(new UpdateCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'SET #oauth_state = :oauth_state, #updated_at = :updated_at',
    ExpressionAttributeNames: { '#oauth_state': 'oauth_state', '#updated_at': 'updated_at' },
    ExpressionAttributeValues: {
      ':oauth_state': {
        purpose: 'calendar',
        state_hash: stateHash(userId, state),
        expires_at: expiresAt,
        provider_user_id: link.providerUserId,
        primary: link.primary,
        link_guard_field: link.guardField,
        link_guard_value: link.guardValue,
        mode,
      },
      ':updated_at': timestamp(),
    },
  }));
}

async function consumeState(userId, state) {
  try {
    const response = await docClient.send(new UpdateCommand({
      TableName: CALENDAR_CONNECTIONS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: 'REMOVE #oauth_state SET #updated_at = :updated_at',
      ConditionExpression: '#oauth_state.#purpose = :purpose AND #oauth_state.#state_hash = :state_hash AND #oauth_state.#expires_at >= :now',
      ExpressionAttributeNames: {
        '#oauth_state': 'oauth_state',
        '#purpose': 'purpose',
        '#state_hash': 'state_hash',
        '#expires_at': 'expires_at',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':purpose': 'calendar',
        ':state_hash': stateHash(userId, state),
        ':now': Math.floor(Date.now() / 1000),
        ':updated_at': timestamp(),
      },
      ReturnValues: 'ALL_OLD',
    }));
    return response.Attributes?.oauth_state || null;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

function authorizationUrl(config, state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: `openid email ${CALENDAR_SCOPE}`,
    state,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  }).toString();
  return url.toString();
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ProviderError('Google could not be reached');
  }
  let data;
  try { data = await response.json(); } catch { throw new ProviderError('Google returned an invalid response'); }
  if (!response.ok) throw new ProviderError('Google rejected the Calendar authorization request');
  return data;
}

async function exchangeCode(code, config) {
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
  const scopes = new Set(String(token.scope || '').split(/\s+/).filter(Boolean));
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string') {
    throw new ProviderError('Google did not return offline Calendar access; try enabling synchronization again');
  }
  if (!scopes.has(CALENDAR_SCOPE)) throw new ProviderError('Google Calendar permission was not granted');

  const user = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (typeof user.sub !== 'string' || typeof user.email !== 'string' || user.email_verified !== true) {
    throw new ProviderError('Google did not return a verified account');
  }
  return { token, user };
}

async function storeCredentialForActiveLink(userId, link, values) {
  if (link.primary) return setConnectionStatus(userId, values, ['reconcile']);
  if (!['link_version', 'connected_at'].includes(link.guardField) || !link.guardValue) {
    throw new ProviderError('The linked Google account changed; link it again before enabling Calendar');
  }

  const now = timestamp();
  await docClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        ConditionCheck: {
          TableName: USERS_TABLE,
          Key: { user_id: userId },
          ConditionExpression: '#connection.#provider = :provider AND #connection.#guard = :guard AND (#connection.#status = :active OR attribute_not_exists(#connection.#status))',
          ExpressionAttributeNames: {
            '#connection': 'oauth_connection_google',
            '#provider': 'provider_user_id',
            '#guard': link.guardField,
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':provider': link.providerUserId,
            ':guard': link.guardValue,
            ':active': 'active',
          },
        },
      },
      {
        Update: {
          TableName: CALENDAR_CONNECTIONS_TABLE,
          Key: { user_id: userId },
          UpdateExpression: 'SET #status = :status, #enabled = :enabled, #provider = :provider, #email = :email, #scope = :scope, #credential = :credential, #connected_at = :connected_at, #last_error = :last_error, #updated_at = :updated_at REMOVE #reconcile',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#enabled': 'enabled',
            '#provider': 'provider_user_id',
            '#email': 'calendar_email',
            '#scope': 'granted_scope',
            '#credential': 'encrypted_refresh_token',
            '#connected_at': 'connected_at',
            '#last_error': 'last_error',
            '#updated_at': 'updated_at',
            '#reconcile': 'reconcile',
          },
          ExpressionAttributeValues: {
            ':status': values.status,
            ':enabled': values.enabled,
            ':provider': values.provider_user_id,
            ':email': values.calendar_email,
            ':scope': values.granted_scope,
            ':credential': values.encrypted_refresh_token,
            ':connected_at': values.connected_at,
            ':last_error': null,
            ':updated_at': now,
          },
        },
      },
    ],
  }));
  return getConnection(userId);
}

async function authorize(event, profile) {
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();
  const link = googleLink(profile, event);
  if (!link.linked || !link.providerUserId) return error('Link a Google account before enabling Calendar synchronization', 409);
  if (!isCalendarConfigured({ requireEncryption: true })) return error('Google Calendar synchronization is not configured', 503);

  const userId = getUserId(event);
  const existingConnection = await getConnection(userId);
  const mode = existingConnection?.status === 'cleanup_reauthorization_required' ? 'cleanup' : 'enable';
  const state = `calendar.${randomBytes(32).toString('base64url')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  await saveState(userId, state, expiresAt, link, mode);
  return success({
    calendar_sync: publicCalendarStatus(await getConnection(userId), true),
    authorization_url: authorizationUrl(calendarConfig(), state),
    expires_at: new Date(expiresAt * 1000).toISOString(),
  });
}

async function cancelOAuth(event, body) {
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();
  if (typeof body.state !== 'string' || !/^calendar\.[A-Za-z0-9_-]{43}$/.test(body.state)) {
    return error('Invalid or expired Calendar OAuth state', 400);
  }
  const consumedState = await consumeState(getUserId(event), body.state);
  if (!consumedState) return error('Invalid or expired Calendar OAuth state', 400);
  return success({ cancelled: true });
}

async function callback(event, body) {
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();
  if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 4096) return error('A valid OAuth code is required', 400);
  if (typeof body.state !== 'string' || !/^calendar\.[A-Za-z0-9_-]{43}$/.test(body.state)) return error('Invalid or expired Calendar OAuth state', 400);

  const userId = getUserId(event);
  const consumedState = await consumeState(userId, body.state);
  if (!consumedState) return error('Invalid or expired Calendar OAuth state', 400);
  if (!isCalendarConfigured({ requireEncryption: true })) return error('Google Calendar synchronization is not configured', 503);

  const currentProfile = await getGoogleLinkProfile(userId);
  const link = googleLink(currentProfile, event);
  const sameLink = link.linked
    && link.providerUserId === consumedState.provider_user_id
    && link.primary === consumedState.primary
    && (link.primary || (link.guardField === consumedState.link_guard_field && link.guardValue === consumedState.link_guard_value));
  if (!sameLink) return error('The linked Google account changed; start Calendar authorization again', 409);

  const { token, user } = await exchangeCode(body.code.trim(), calendarConfig());
  if (user.sub !== link.providerUserId) return error('Authorize the same Google account that is linked to this profile', 409);
  const expectedEmail = getUserEmail(event);
  if (!expectedEmail || user.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    return error('Authorize the Google account with the same verified email as this profile', 409);
  }

  const cleanupMode = consumedState.mode === 'cleanup';
  try {
    await storeCredentialForActiveLink(userId, link, {
      status: cleanupMode ? 'disable_pending' : 'enabled',
      enabled: !cleanupMode,
      provider_user_id: user.sub,
      calendar_email: user.email,
      granted_scope: CALENDAR_SCOPE,
      encrypted_refresh_token: encryptRefreshToken(token.refresh_token, userId),
      connected_at: timestamp(),
    });
  } catch (transactionError) {
    if (transactionError.name === 'TransactionCanceledException') {
      return error('The linked Google account changed; start Calendar authorization again', 409);
    }
    throw transactionError;
  }

  return success({ calendar_sync: publicCalendarStatus(await getConnection(userId), true) }, 202);
}

async function syncNow(event, profile) {
  const link = googleLink(profile, event);
  if (!link.linked) return error('Link a Google account before synchronizing Calendar', 409);
  const connection = await getConnection(getUserId(event));
  if (!connection?.enabled || connection.status !== 'enabled') return error('Google Calendar synchronization is not enabled', 409);
  await setConnectionStatus(getUserId(event), {
    reconcile: { phase: 'tasks', task_cursor: null },
    last_error: null,
  });
  return success({ calendar_sync: publicCalendarStatus(await getConnection(getUserId(event)), true) }, 202);
}

async function disable(event, profile) {
  if (!hasRecentAuthentication(event)) return recentAuthenticationError();
  const userId = getUserId(event);
  const link = googleLink(profile, event);
  const connection = await getConnection(userId);
  if (connection?.status === 'cleanup_reauthorization_required') {
    return error('Reauthorize Google Calendar to finish removing managed events', 409);
  }
  if (!connection) {
    return success({ calendar_sync: publicCalendarStatus(null, link.linked) });
  }
  if (!connection.encrypted_refresh_token) {
    return error('Calendar cleanup state is incomplete; reauthorize to finish cleanup', 409);
  }

  await setConnectionStatus(userId, { status: 'disable_pending', enabled: false, last_error: null });
  return success({ calendar_sync: publicCalendarStatus(await getConnection(userId), link.linked) }, 202);
}

exports.getStatus = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const [profile, record] = await Promise.all([getGoogleLinkProfile(userId), getConnection(userId)]);
    return success({ calendar_sync: publicCalendarStatus(record, googleLink(profile, event).linked) });
  } catch (err) {
    console.error('Calendar status retrieval failed:', err.message);
    return error('Failed to retrieve Calendar synchronization status', 500);
  }
};

exports.update = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const body = parseBody(event);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('Invalid JSON body', 400);
    const profile = await getGoogleLinkProfile(userId);
    switch (body.action) {
      case 'authorize': return await authorize(event, profile);
      case 'callback': return await callback(event, body);
      case 'oauthCancel': return await cancelOAuth(event, body);
      case 'sync': return await syncNow(event, profile);
      case 'disable': return await disable(event, profile);
      default: return error('Invalid Calendar action', 400);
    }
  } catch (err) {
    console.error('Calendar synchronization update failed:', err.message);
    if (err instanceof ProviderError) return error(err.message, 400);
    if (err instanceof CalendarSyncError) {
      return error(err.code === 'reauthorization_required'
        ? 'Google Calendar authorization must be renewed'
        : 'Google Calendar synchronization failed', err.status || 500);
    }
    return error('Failed to update Calendar synchronization', 500);
  }
};

exports._private = {
  authorizationUrl,
  consumeState,
  googleLink,
  publicCalendarStatus,
  stateHash,
};
