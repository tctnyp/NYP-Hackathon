const { createHash, createPublicKey, createSign, randomBytes, timingSafeEqual } = require('node:crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require('@aws-sdk/lib-dynamodb');

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.REGION || 'us-east-1',
}));

const SESSION_TABLE = process.env.DISCORD_OIDC_TABLE;
const ISSUER_OVERRIDE = (process.env.DISCORD_OIDC_ISSUER || '').replace(/\/$/, '');
const BRIDGE_CLIENT_ID = process.env.DISCORD_OIDC_CLIENT_ID;
const BRIDGE_CLIENT_SECRET = process.env.DISCORD_OIDC_CLIENT_SECRET;
const DISCORD_CLIENT_ID = process.env.DISCORD_OAUTH_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_OAUTH_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_OAUTH_REDIRECT_URI;
const COGNITO_REDIRECT_URI = process.env.COGNITO_IDP_RESPONSE_URI;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const KEY_ID = process.env.DISCORD_OIDC_KEY_ID || 'discord-oidc-1';
const PRIVATE_KEY = process.env.DISCORD_OIDC_PRIVATE_KEY_BASE64
  ? Buffer.from(process.env.DISCORD_OIDC_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
  : '';

const STATE_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TTL_SECONDS = 5 * 60;

class OAuthError extends Error {
  constructor(message, statusCode = 400, code = 'invalid_request') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function issuerForEvent(event) {
  if (ISSUER_OVERRIDE) return ISSUER_OVERRIDE;
  const domain = event.requestContext?.domainName;
  const stage = event.requestContext?.stage;
  if (typeof domain !== 'string' || !domain) {
    throw new OAuthError('Discord OIDC issuer is unavailable', 503, 'temporarily_unavailable');
  }
  const stagePath = domain.includes('.execute-api.') && typeof stage === 'string' && stage
    ? `/${stage}`
    : '';
  return `https://${domain}${stagePath}/oidc/discord`;
}

function randomToken(prefix = '') {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

function hashToken(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function recordKey(type, value) {
  return `${type}#${hashToken(value)}`;
}

function baseHeaders(contentType = 'application/json') {
  return {
    'Access-Control-Allow-Origin': APP_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    Pragma: 'no-cache',
  };
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...baseHeaders(), ...headers },
    body: JSON.stringify(body),
  };
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: {
      ...baseHeaders('text/plain; charset=utf-8'),
      Location: location,
    },
    body: 'Redirecting',
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
  if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new OAuthError('Invalid request body');
  }
}

function requireConfiguration() {
  const required = {
    DISCORD_OIDC_TABLE: SESSION_TABLE,
    DISCORD_OIDC_CLIENT_ID: BRIDGE_CLIENT_ID,
    DISCORD_OIDC_CLIENT_SECRET: BRIDGE_CLIENT_SECRET,
    DISCORD_OAUTH_CLIENT_ID: DISCORD_CLIENT_ID,
    DISCORD_OAUTH_CLIENT_SECRET: DISCORD_CLIENT_SECRET,
    DISCORD_OAUTH_REDIRECT_URI: DISCORD_REDIRECT_URI,
    COGNITO_IDP_RESPONSE_URI: COGNITO_REDIRECT_URI,
    DISCORD_OIDC_PRIVATE_KEY_BASE64: PRIVATE_KEY,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new OAuthError('Discord authentication is not configured', 503, 'temporarily_unavailable');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function putRecord(type, token, item, ttlSeconds) {
  await docClient.send(new PutCommand({
    TableName: SESSION_TABLE,
    Item: {
      id: recordKey(type, token),
      type,
      ...item,
      expires_at: nowSeconds() + ttlSeconds,
    },
    ConditionExpression: 'attribute_not_exists(id)',
  }));
}

async function consumeRecord(type, token) {
  const response = await docClient.send(new DeleteCommand({
    TableName: SESSION_TABLE,
    Key: { id: recordKey(type, token) },
    ReturnValues: 'ALL_OLD',
  }));
  const item = response.Attributes;
  if (!item || item.type !== type || item.expires_at < nowSeconds()) return null;
  return item;
}

async function getRecord(type, token) {
  const response = await docClient.send(new GetCommand({
    TableName: SESSION_TABLE,
    Key: { id: recordKey(type, token) },
  }));
  const item = response.Item;
  if (!item || item.type !== type || item.expires_at < nowSeconds()) return null;
  return item;
}

function discovery(event) {
  const issuer = issuerForEvent(event);
  return json(200, {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'auth_time',
      'nonce',
      'email',
      'email_verified',
      'name',
      'preferred_username',
      'picture',
    ],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  }, { 'Cache-Control': 'public, max-age=300' });
}

function jwks() {
  requireConfiguration();
  const publicJwk = createPublicKey(PRIVATE_KEY).export({ format: 'jwk' });
  return json(200, {
    keys: [{
      ...publicJwk,
      alg: 'RS256',
      kid: KEY_ID,
      use: 'sig',
    }],
  }, { 'Cache-Control': 'public, max-age=3600' });
}

async function authorize(event) {
  requireConfiguration();
  const params = event.queryStringParameters || {};
  if (!safeEqual(params.client_id, BRIDGE_CLIENT_ID)) {
    throw new OAuthError('Unknown OIDC client', 400, 'unauthorized_client');
  }
  if (params.response_type !== 'code') {
    throw new OAuthError('Only authorization code flow is supported', 400, 'unsupported_response_type');
  }
  if (!safeEqual(params.redirect_uri, COGNITO_REDIRECT_URI)) {
    throw new OAuthError('Invalid OIDC redirect URI');
  }
  if (typeof params.state !== 'string' || !params.state || params.state.length > 2048) {
    throw new OAuthError('Missing or invalid OIDC state');
  }
  const scopes = new Set((params.scope || '').split(/\s+/).filter(Boolean));
  if (!scopes.has('openid')) throw new OAuthError('The openid scope is required', 400, 'invalid_scope');
  if (params.nonce && (typeof params.nonce !== 'string' || params.nonce.length > 2048)) {
    throw new OAuthError('Invalid nonce');
  }

  const discordState = randomToken('oidc.');
  await putRecord('state', discordState, {
    client_id: params.client_id,
    cognito_redirect_uri: params.redirect_uri,
    cognito_state: params.state,
    nonce: params.nonce || null,
  }, STATE_TTL_SECONDS);

  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    state: discordState,
    prompt: 'consent',
  }).toString();
  return redirect(url.toString());
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new OAuthError('Discord could not be reached', 502, 'temporarily_unavailable');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new OAuthError('Discord returned an invalid response', 502, 'server_error');
  }
  if (!response.ok) throw new OAuthError('Discord rejected the authorization request', 400, 'access_denied');
  return data;
}

async function exchangeDiscordCode(code) {
  const token = await fetchJson('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
    }),
  });
  if (typeof token.access_token !== 'string') throw new OAuthError('Discord did not issue an access token');

  const user = await fetchJson('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (
    typeof user.id !== 'string'
    || typeof user.username !== 'string'
    || typeof user.email !== 'string'
    || user.verified !== true
  ) {
    throw new OAuthError('A verified Discord email is required', 400, 'access_denied');
  }

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png`
    : null;
  return {
    sub: user.id,
    email: user.email,
    email_verified: true,
    name: typeof user.global_name === 'string' && user.global_name ? user.global_name : user.username,
    preferred_username: user.username,
    ...(avatar ? { picture: avatar } : {}),
  };
}

function cognitoErrorRedirect(transaction, errorCode, description) {
  const url = new URL(transaction.cognito_redirect_uri);
  url.search = new URLSearchParams({
    error: errorCode,
    error_description: description,
    state: transaction.cognito_state,
  }).toString();
  return url.toString();
}

async function callback(event) {
  requireConfiguration();
  const body = parseBody(event);
  if (typeof body.state !== 'string' || !body.state.startsWith('oidc.') || body.state.length > 512) {
    throw new OAuthError('Invalid or expired Discord login state');
  }
  const transaction = await consumeRecord('state', body.state);
  if (!transaction) throw new OAuthError('Invalid or expired Discord login state');

  if (body.error) {
    return json(200, {
      redirect_url: cognitoErrorRedirect(
        transaction,
        body.error === 'access_denied' ? 'access_denied' : 'server_error',
        typeof body.error_description === 'string' ? body.error_description.slice(0, 500) : 'Discord login was cancelled',
      ),
    });
  }
  if (typeof body.code !== 'string' || !body.code || body.code.length > 4096) {
    throw new OAuthError('Discord authorization code is missing');
  }

  let claims;
  try {
    claims = await exchangeDiscordCode(body.code);
  } catch (error) {
    if (error instanceof OAuthError) {
      return json(200, {
        redirect_url: cognitoErrorRedirect(transaction, error.code, error.message),
      });
    }
    throw error;
  }

  const authorizationCode = randomToken();
  await putRecord('code', authorizationCode, {
    client_id: transaction.client_id,
    redirect_uri: transaction.cognito_redirect_uri,
    nonce: transaction.nonce,
    claims,
  }, CODE_TTL_SECONDS);

  const url = new URL(transaction.cognito_redirect_uri);
  url.search = new URLSearchParams({
    code: authorizationCode,
    state: transaction.cognito_state,
  }).toString();
  return json(200, { redirect_url: url.toString() });
}

function clientCredentials(event, body) {
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  if (authorization.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separator)),
          clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
        };
      }
    } catch {
      return { clientId: null, clientSecret: null };
    }
  }
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signIdToken(claims, nonce, issuer) {
  const issuedAt = nowSeconds();
  const payload = {
    iss: issuer,
    sub: claims.sub,
    aud: BRIDGE_CLIENT_ID,
    exp: issuedAt + ACCESS_TTL_SECONDS,
    iat: issuedAt,
    auth_time: issuedAt,
    ...(nonce ? { nonce } : {}),
    email: claims.email,
    email_verified: claims.email_verified,
    name: claims.name,
    preferred_username: claims.preferred_username,
    ...(claims.picture ? { picture: claims.picture } : {}),
  };
  const encoded = `${base64urlJson({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })}.${base64urlJson(payload)}`;
  const signature = createSign('RSA-SHA256').update(encoded).end().sign(PRIVATE_KEY).toString('base64url');
  return `${encoded}.${signature}`;
}

async function token(event) {
  requireConfiguration();
  const body = parseBody(event);
  const credentials = clientCredentials(event, body);
  if (!safeEqual(credentials.clientId, BRIDGE_CLIENT_ID) || !safeEqual(credentials.clientSecret, BRIDGE_CLIENT_SECRET)) {
    throw new OAuthError('Invalid OIDC client credentials', 401, 'invalid_client');
  }
  if (body.grant_type !== 'authorization_code') {
    throw new OAuthError('Unsupported grant type', 400, 'unsupported_grant_type');
  }
  if (typeof body.code !== 'string' || !body.code || body.code.length > 512) {
    throw new OAuthError('Invalid authorization code', 400, 'invalid_grant');
  }

  const authorization = await consumeRecord('code', body.code);
  if (
    !authorization
    || !safeEqual(authorization.client_id, credentials.clientId)
    || !safeEqual(authorization.redirect_uri, body.redirect_uri)
  ) {
    throw new OAuthError('Invalid or expired authorization code', 400, 'invalid_grant');
  }

  const accessToken = randomToken();
  await putRecord('access', accessToken, { claims: authorization.claims }, ACCESS_TTL_SECONDS);
  return json(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    id_token: signIdToken(authorization.claims, authorization.nonce, issuerForEvent(event)),
    scope: 'openid profile email',
  });
}

async function userinfo(event) {
  requireConfiguration();
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authorization.startsWith('Bearer ')) throw new OAuthError('Bearer token required', 401, 'invalid_token');
  const access = await getRecord('access', authorization.slice(7));
  if (!access) throw new OAuthError('Invalid or expired access token', 401, 'invalid_token');
  return json(200, access.claims);
}

exports.handler = async (event) => {
  try {
    if ((event.httpMethod || '').toUpperCase() === 'OPTIONS') return json(204, {});
    const path = event.path || event.rawPath || '';
    const method = (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();

    if (path.endsWith('/.well-known/openid-configuration') && method === 'GET') return discovery(event);
    if (path.endsWith('/jwks.json') && method === 'GET') return jwks();
    if (path.endsWith('/authorize') && method === 'GET') return await authorize(event);
    if (path.endsWith('/callback') && method === 'POST') return await callback(event);
    if (path.endsWith('/token') && method === 'POST') return await token(event);
    if (path.endsWith('/userinfo') && method === 'GET') return await userinfo(event);
    return json(404, { error: 'not_found', error_description: 'OIDC endpoint not found' });
  } catch (error) {
    console.error('Discord OIDC request failed:', error.message);
    if (error instanceof OAuthError) {
      const headers = error.statusCode === 401 ? { 'WWW-Authenticate': 'Basic realm="discord-oidc"' } : {};
      return json(error.statusCode, { error: error.code, error_description: error.message }, headers);
    }
    return json(500, { error: 'server_error', error_description: 'Discord authentication failed' });
  }
};
