/**
 * Utility functions for Lambda responses
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Create a successful response
 */
function success(data, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}

/**
 * Create an error response
 */
function error(message, statusCode = 400, details = null) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: false,
      error: message,
      details,
    }),
  };
}

/**
 * Extract claims from API Gateway REST or HTTP API authorizers.
 */
function getClaims(event) {
  return event?.requestContext?.authorizer?.claims
    || event?.requestContext?.authorizer?.jwt?.claims
    || {};
}

function getUserId(event) {
  return getClaims(event).sub || null;
}

function getUserEmail(event) {
  return getClaims(event).email || null;
}

function getUsername(event) {
  const claims = getClaims(event);
  return claims['cognito:username'] || claims.username || claims.email || claims.sub || null;
}

function getUserName(event) {
  const claims = getClaims(event);
  const composedName = [claims.given_name, claims.family_name].filter(Boolean).join(' ');
  return claims.name || composedName || null;
}

function getGroups(event) {
  const rawGroups = getClaims(event)['cognito:groups'];
  if (Array.isArray(rawGroups)) return rawGroups;
  if (typeof rawGroups !== 'string' || !rawGroups.trim()) return [];

  const normalized = rawGroups.trim().replace(/^\[/, '').replace(/\]$/, '');
  return normalized
    .split(',')
    .map((group) => group.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function isAdmin(event) {
  const claims = getClaims(event);
  const username = claims['cognito:username'] || claims.username || null;
  const allowedAdminUsername = process.env.ADMIN_USERNAME || 'admin';
  return username === allowedAdminUsername && getGroups(event).includes('Admins');
}

/**
 * Parse JSON body safely
 */
function parseBody(event) {
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (e) {
    return null;
  }
}

/**
 * Validate required fields
 */
function validateRequired(data, fields) {
  const missing = [];
  for (const field of fields) {
    if (!data[field] && data[field] !== 0) {
      missing.push(field);
    }
  }
  return missing.length > 0 ? missing : null;
}

module.exports = {
  success,
  error,
  getClaims,
  getUserId,
  getUserEmail,
  getUsername,
  getUserName,
  getGroups,
  isAdmin,
  parseBody,
  validateRequired,
  CORS_HEADERS,
};
