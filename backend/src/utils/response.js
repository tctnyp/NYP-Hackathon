/**
 * Utility functions for Lambda responses
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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
 * Extract user ID from an API authorizer or the explicit lab fallback
 */
function getUserId(event) {
  return event.requestContext?.authorizer?.claims?.sub || process.env.DEFAULT_USER_ID || null;
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
  getUserId,
  parseBody,
  validateRequired,
  CORS_HEADERS,
};
