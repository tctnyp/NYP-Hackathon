const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require('node:crypto');
const {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  docClient,
  TASKS_TABLE,
  USERS_TABLE,
} = require('./database');

const CALENDAR_CONNECTIONS_TABLE = process.env.CALENDAR_CONNECTIONS_TABLE || 'academic-google-calendar-connections';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const APP_MARKER = 'academic-task-manager';
const KEY_VERSION = 'v1';
const MAX_PROVIDER_ATTEMPTS = 3;

class CalendarSyncError extends Error {
  constructor(message, { code = 'calendar_sync_failed', retryable = false, status = 500 } = {}) {
    super(message);
    this.name = 'CalendarSyncError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function timestamp() {
  return new Date().toISOString();
}

function calendarConfig() {
  return {
    enabled: process.env.GOOGLE_CALENDAR_SYNC_ENABLED === 'true',
    clientId: process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI,
    encryptionKey: process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY_BASE64,
    environment: process.env.ENVIRONMENT || 'dev',
    revokeOnDisable: process.env.GOOGLE_CALENDAR_REVOKE_ON_DISABLE === 'true',
  };
}

function isCalendarConfigured({ requireEncryption = false } = {}) {
  const config = calendarConfig();
  if (!config.enabled || !config.clientId || !config.redirectUri) return false;
  if (!requireEncryption) return true;
  if (!config.clientSecret) return false;
  try {
    encryptionKey(config.encryptionKey);
    return true;
  } catch {
    return false;
  }
}

function encryptionKey(value = calendarConfig().encryptionKey) {
  if (typeof value !== 'string' || !value) {
    throw new CalendarSyncError('Calendar credential encryption is not configured', { code: 'configuration_error' });
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new CalendarSyncError('Calendar credential encryption key is invalid', { code: 'configuration_error' });
  }
  return key;
}

function credentialAad(userId) {
  return Buffer.from(`${KEY_VERSION}\0google-calendar\0${userId}`, 'utf8');
}

function encryptRefreshToken(refreshToken, userId, keyValue) {
  if (typeof refreshToken !== 'string' || !refreshToken || typeof userId !== 'string' || !userId) {
    throw new CalendarSyncError('Calendar credential cannot be encrypted', { code: 'invalid_credential' });
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyValue), iv);
  cipher.setAAD(credentialAad(userId));
  const ciphertext = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  return {
    version: KEY_VERSION,
    algorithm: 'A256GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptRefreshToken(encrypted, userId, keyValue) {
  try {
    if (!encrypted || encrypted.version !== KEY_VERSION || encrypted.algorithm !== 'A256GCM') throw new Error('version');
    const iv = Buffer.from(encrypted.iv, 'base64');
    const tag = Buffer.from(encrypted.tag, 'base64');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error('shape');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyValue), iv);
    decipher.setAAD(credentialAad(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof CalendarSyncError) throw err;
    throw new CalendarSyncError('Stored calendar credential could not be decrypted', {
      code: 'credential_unavailable',
      status: 500,
    });
  }
}

function ownerMarker(userId) {
  return createHash('sha256').update(`calendar-owner\0${userId}`).digest('hex').slice(0, 32);
}

function googleEventId(userId, taskId, environment = calendarConfig().environment) {
  const digest = createHash('sha256')
    .update(`${environment}\0${userId}\0${taskId}`, 'utf8')
    .digest('hex');
  return `at${digest}`;
}

function taskWindow(task) {
  const end = new Date(task.deadline);
  if (!Number.isFinite(end.getTime())) {
    throw new CalendarSyncError('Task deadline is invalid', { code: 'invalid_task', status: 400 });
  }
  const requestedHours = Number(task.estimated_hours || 1);
  const durationHours = Math.min(Math.max(Number.isFinite(requestedHours) ? requestedHours : 1, 0.5), 12);
  return {
    start: new Date(end.getTime() - durationHours * 3_600_000).toISOString(),
    end: end.toISOString(),
  };
}

function taskDescription(task) {
  return [
    typeof task.description === 'string' ? task.description.trim() : '',
    `Type: ${String(task.task_type || 'other').replace('_', ' ')}`,
    `Difficulty: ${String(task.difficulty || 'medium').replace('_', ' ')}`,
    `Progress: ${Number(task.progress_percentage || 0)}%`,
  ].filter(Boolean).join('\n');
}

function googleEvent(task, userId) {
  const window = taskWindow(task);
  return {
    id: googleEventId(userId, task.task_id),
    summary: String(task.title || 'Academic task').slice(0, 1024),
    description: taskDescription(task).slice(0, 8192),
    start: { dateTime: window.start },
    end: { dateTime: window.end },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }],
    },
    extendedProperties: {
      private: {
        app: APP_MARKER,
        owner: ownerMarker(userId),
        task_id: String(task.task_id),
      },
    },
  };
}

function isOwnedEvent(event, userId, taskId) {
  const properties = event?.extendedProperties?.private;
  return properties?.app === APP_MARKER
    && properties?.owner === ownerMarker(userId)
    && (taskId === undefined || properties?.task_id === String(taskId));
}

function safeProviderCode(status, data) {
  if (data?.error === 'invalid_grant') return 'reauthorization_required';
  if (status === 401) return 'reauthorization_required';
  if (status === 403 || status === 429) return 'provider_temporarily_unavailable';
  return 'calendar_sync_failed';
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function providerRequest(url, options = {}, { allowNotFound = false, allowConflict = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    } catch {
      lastError = new CalendarSyncError('Google Calendar could not be reached', {
        code: 'provider_temporarily_unavailable', retryable: true, status: 503,
      });
      if (attempt < MAX_PROVIDER_ATTEMPTS - 1) {
        await sleep((100 * (2 ** attempt)) + Math.floor(Math.random() * 100));
        continue;
      }
      throw lastError;
    }

    if (allowNotFound && (response.status === 404 || response.status === 410)) return { status: response.status, data: null };
    if (allowConflict && response.status === 409) return { status: 409, data: null };

    let data = null;
    const text = await response.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (response.ok) return { status: response.status, data };

    lastError = new CalendarSyncError('Google Calendar rejected the request', {
      code: safeProviderCode(response.status, data),
      retryable: retryableStatus(response.status),
      status: response.status,
    });
    if (lastError.retryable && attempt < MAX_PROVIDER_ATTEMPTS - 1) {
      await sleep((100 * (2 ** attempt)) + Math.floor(Math.random() * 100));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

async function getConnection(userId) {
  const response = await docClient.send(new GetCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    Key: { user_id: userId },
  }));
  return response.Item || null;
}

async function setConnectionStatus(userId, updates, remove = []) {
  const names = { '#updated_at': 'updated_at' };
  const values = { ':updated_at': timestamp() };
  const sets = ['#updated_at = :updated_at'];
  Object.entries(updates).forEach(([name, value], index) => {
    names[`#field${index}`] = name;
    values[`:value${index}`] = value;
    sets.push(`#field${index} = :value${index}`);
  });
  const removes = remove.map((name, index) => {
    names[`#remove${index}`] = name;
    return `#remove${index}`;
  });
  const response = await docClient.send(new UpdateCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));
  return response.Attributes;
}

async function markSyncResult(userId, { errorCode = null, disableCredential = false } = {}) {
  const now = timestamp();
  if (disableCredential) {
    return setConnectionStatus(userId, {
      status: 'reauthorization_required',
      enabled: false,
      last_error: 'reauthorization_required',
      last_attempt_at: now,
    }, ['encrypted_refresh_token']);
  }
  return setConnectionStatus(userId, {
    last_attempt_at: now,
    ...(errorCode ? { last_error: errorCode } : { last_sync_at: now, last_error: null }),
  });
}

async function accessTokenForConnection(connection) {
  const config = calendarConfig();
  const refreshToken = decryptRefreshToken(connection.encrypted_refresh_token, connection.user_id, config.encryptionKey);
  const response = await providerRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (typeof response.data?.access_token !== 'string') {
    throw new CalendarSyncError('Google did not return an access token', { code: 'reauthorization_required', status: 401 });
  }
  return response.data.access_token;
}

function calendarApiUrl(path, query = null) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((entry) => url.searchParams.append(key, String(entry)));
    });
  }
  return url.toString();
}

function bearer(accessToken, extra = {}) {
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

async function getOwnedEvent(accessToken, eventId, userId, taskId) {
  const response = await providerRequest(calendarApiUrl(`events/${encodeURIComponent(eventId)}`), {
    headers: bearer(accessToken),
  }, { allowNotFound: true });
  if (!response.data) return null;
  if (!isOwnedEvent(response.data, userId, taskId)) {
    throw new CalendarSyncError('A Google Calendar event ID collision was detected', {
      code: 'event_ownership_conflict', status: 409,
    });
  }
  return response.data;
}

async function upsertTaskEvent(accessToken, task, userId) {
  const event = googleEvent(task, userId);
  const insert = await providerRequest(calendarApiUrl('events'), {
    method: 'POST',
    headers: bearer(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(event),
  }, { allowConflict: true });
  if (insert.status !== 409) return insert.data;

  await getOwnedEvent(accessToken, event.id, userId, task.task_id);
  const update = await providerRequest(calendarApiUrl(`events/${encodeURIComponent(event.id)}`), {
    method: 'PUT',
    headers: bearer(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(event),
  });
  return update.data;
}

async function deleteTaskEvent(accessToken, taskId, userId) {
  const eventId = googleEventId(userId, taskId);
  const existing = await getOwnedEvent(accessToken, eventId, userId, taskId);
  if (!existing) return false;
  await providerRequest(calendarApiUrl(`events/${encodeURIComponent(eventId)}`), {
    method: 'DELETE',
    headers: bearer(accessToken),
  }, { allowNotFound: true });
  return true;
}

async function queryAllTasks(userId) {
  const tasks = [];
  let ExclusiveStartKey;
  do {
    const response = await docClient.send(new QueryCommand({
      TableName: TASKS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'TASK#' },
      ExclusiveStartKey,
    }));
    tasks.push(...(response.Items || []).filter((item) => item.entity_type === 'TASK'));
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return tasks;
}

async function listOwnedEvents(accessToken, userId) {
  const events = [];
  let pageToken;
  do {
    const response = await providerRequest(calendarApiUrl('events', {
      privateExtendedProperty: [`app=${APP_MARKER}`, `owner=${ownerMarker(userId)}`],
      maxResults: 2500,
      showDeleted: false,
      singleEvents: true,
      ...(pageToken ? { pageToken } : {}),
    }), { headers: bearer(accessToken) });
    events.push(...(response.data?.items || []).filter((event) => isOwnedEvent(event, userId)));
    pageToken = response.data?.nextPageToken;
  } while (pageToken);
  return events;
}

async function syncTaskForUser(userId, task) {
  const connection = await getConnection(userId);
  if (!connection?.enabled || connection.status !== 'enabled' || !connection.encrypted_refresh_token) {
    return { synced: false, reason: 'disabled' };
  }
  try {
    const accessToken = await accessTokenForConnection(connection);
    if (!task || task.status === 'completed') {
      await deleteTaskEvent(accessToken, task?.task_id, userId);
    } else {
      await upsertTaskEvent(accessToken, task, userId);
    }
    await markSyncResult(userId);
    return { synced: true };
  } catch (err) {
    const syncError = err instanceof CalendarSyncError ? err : new CalendarSyncError('Calendar synchronization failed');
    await markSyncResult(userId, {
      errorCode: syncError.code,
      disableCredential: syncError.code === 'reauthorization_required',
    });
    throw syncError;
  }
}

async function deleteTaskForUser(userId, taskId) {
  return syncTaskForUser(userId, { task_id: taskId, status: 'completed' });
}

async function queryTaskPage(userId, cursor, limit = 5) {
  const response = await docClient.send(new QueryCommand({
    TableName: TASKS_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'TASK#' },
    ExclusiveStartKey: cursor || undefined,
    Limit: limit,
  }));
  return {
    items: (response.Items || []).filter((item) => item.entity_type === 'TASK'),
    nextKey: response.LastEvaluatedKey || null,
  };
}

async function getTaskForEvent(userId, taskId) {
  const response = await docClient.send(new GetCommand({
    TableName: TASKS_TABLE,
    Key: { PK: `USER#${userId}`, SK: `TASK#${taskId}` },
  }));
  return response.Item || null;
}

async function listOwnedEventPage(accessToken, userId, pageToken, limit = 5) {
  const response = await providerRequest(calendarApiUrl('events', {
    privateExtendedProperty: [`app=${APP_MARKER}`, `owner=${ownerMarker(userId)}`],
    maxResults: limit,
    showDeleted: false,
    singleEvents: true,
    ...(pageToken ? { pageToken } : {}),
  }), { headers: bearer(accessToken) });
  return {
    items: (response.data?.items || []).filter((event) => isOwnedEvent(event, userId)),
    nextPageToken: response.data?.nextPageToken || null,
  };
}

async function reconcileUserCalendar(userId, { removeAll = false, limit = 5 } = {}) {
  const connection = await getConnection(userId);
  const canRun = connection?.encrypted_refresh_token
    && (connection.status === 'enabled' || connection.status === 'disable_pending');
  if (!canRun) return { synced: false, reason: 'disabled', complete: false };

  try {
    const accessToken = await accessTokenForConnection(connection);

    if (removeAll || connection.status === 'disable_pending') {
      const page = await listOwnedEventPage(accessToken, userId, null, limit);
      for (const event of page.items) {
        await providerRequest(calendarApiUrl(`events/${encodeURIComponent(event.id)}`), {
          method: 'DELETE', headers: bearer(accessToken),
        }, { allowNotFound: true });
      }
      if (page.items.length > 0) {
        await setConnectionStatus(userId, {
          status: 'disable_pending', enabled: false, last_attempt_at: timestamp(), last_error: null,
        });
        return { synced: true, removed: page.items.length, pending: true, complete: false };
      }
      await setConnectionStatus(userId, {
        status: 'disable_pending', enabled: false, last_sync_at: timestamp(), last_attempt_at: timestamp(), last_error: null,
      }, ['reconcile']);
      return { synced: true, removed: 0, pending: false, complete: true };
    }

    const checkpoint = connection.reconcile || { phase: 'tasks', task_cursor: null };
    if (checkpoint.phase === 'tasks') {
      const page = await queryTaskPage(userId, checkpoint.task_cursor, limit);
      for (const task of page.items) {
        if (task.status === 'completed') await deleteTaskEvent(accessToken, task.task_id, userId);
        else await upsertTaskEvent(accessToken, task, userId);
      }
      await setConnectionStatus(userId, {
        reconcile: page.nextKey
          ? { phase: 'tasks', task_cursor: page.nextKey }
          : { phase: 'events', event_page_token: null },
        last_attempt_at: timestamp(),
        last_error: null,
      });
      return { synced: true, processed: page.items.length, pending: true, complete: false };
    }

    const page = await listOwnedEventPage(accessToken, userId, checkpoint.event_page_token, limit);
    for (const event of page.items) {
      const taskId = event.extendedProperties.private.task_id;
      const task = await getTaskForEvent(userId, taskId);
      if (!task || task.status === 'completed') {
        await providerRequest(calendarApiUrl(`events/${encodeURIComponent(event.id)}`), {
          method: 'DELETE', headers: bearer(accessToken),
        }, { allowNotFound: true });
      }
    }
    if (page.nextPageToken) {
      await setConnectionStatus(userId, {
        reconcile: { phase: 'events', event_page_token: page.nextPageToken },
        last_attempt_at: timestamp(),
        last_error: null,
      });
      return { synced: true, processed: page.items.length, pending: true, complete: false };
    }

    const now = timestamp();
    await setConnectionStatus(userId, {
      last_sync_at: now,
      last_attempt_at: now,
      last_error: null,
    }, ['reconcile']);
    return { synced: true, processed: page.items.length, pending: false, complete: true };
  } catch (err) {
    const syncError = err instanceof CalendarSyncError ? err : new CalendarSyncError('Calendar synchronization failed');
    if (syncError.code === 'reauthorization_required' && connection.status === 'disable_pending') {
      await setConnectionStatus(userId, {
        status: 'cleanup_reauthorization_required',
        enabled: false,
        last_error: 'cleanup_reauthorization_required',
        last_attempt_at: timestamp(),
      }, ['encrypted_refresh_token', 'reconcile']);
    } else {
      await markSyncResult(userId, {
        errorCode: syncError.code,
        disableCredential: syncError.code === 'reauthorization_required',
      });
    }
    throw syncError;
  }
}

async function revokeRefreshTokenIfConfigured(userId) {
  const config = calendarConfig();
  if (!config.revokeOnDisable) return false;
  const connection = await getConnection(userId);
  if (!connection?.encrypted_refresh_token) return false;
  const token = decryptRefreshToken(connection.encrypted_refresh_token, userId, config.encryptionKey);
  await providerRequest('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return true;
}

async function finishDisable(userId) {
  await docClient.send(new DeleteCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    Key: { user_id: userId },
  }));
}

async function scanConnections(limit = 5) {
  const schedulerKey = { user_id: '__calendar_scheduler__' };
  const scheduler = await docClient.send(new GetCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    Key: schedulerKey,
  }));
  const response = await docClient.send(new ScanCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    FilterExpression: '(#status = :enabled OR #status = :pending) AND user_id <> :scheduler',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':enabled': 'enabled',
      ':pending': 'disable_pending',
      ':scheduler': schedulerKey.user_id,
    },
    ExclusiveStartKey: scheduler.Item?.scan_cursor || undefined,
    Limit: Math.max(limit, 1),
  }));
  await docClient.send(new UpdateCommand({
    TableName: CALENDAR_CONNECTIONS_TABLE,
    Key: schedulerKey,
    UpdateExpression: 'SET #cursor = :cursor, #updated_at = :updated_at',
    ExpressionAttributeNames: { '#cursor': 'scan_cursor', '#updated_at': 'updated_at' },
    ExpressionAttributeValues: {
      ':cursor': response.LastEvaluatedKey || null,
      ':updated_at': timestamp(),
    },
  }));
  return response.Items || [];
}

async function getGoogleLinkProfile(userId) {
  const response = await docClient.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { user_id: userId },
  }));
  return response.Item || null;
}

module.exports = {
  APP_MARKER,
  CALENDAR_CONNECTIONS_TABLE,
  CALENDAR_SCOPE,
  CalendarSyncError,
  accessTokenForConnection,
  calendarConfig,
  deleteTaskEvent,
  deleteTaskForUser,
  decryptRefreshToken,
  encryptRefreshToken,
  finishDisable,
  getConnection,
  getGoogleLinkProfile,
  googleEvent,
  googleEventId,
  isCalendarConfigured,
  isOwnedEvent,
  listOwnedEvents,
  markSyncResult,
  ownerMarker,
  queryAllTasks,
  reconcileUserCalendar,
  revokeRefreshTokenIfConfigured,
  scanConnections,
  setConnectionStatus,
  syncTaskForUser,
  upsertTaskEvent,
};
