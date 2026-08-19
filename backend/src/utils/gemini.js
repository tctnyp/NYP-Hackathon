'use strict';

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiServiceError extends Error {
  constructor(message, statusCode = 502, code = 'GEMINI_UPSTREAM_ERROR') {
    super(message);
    this.name = 'GeminiServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function configuredApiKeys(env = process.env) {
  return [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3]
    .map((key) => key?.trim())
    .filter(Boolean);
}

function isRateLimited(response, body) {
  return response.status === 429
    || body?.error?.code === 429
    || body?.error?.status === 'RESOURCE_EXHAUSTED';
}

function responseText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => part?.text || '').join('').trim();
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function generateContent({ prompt, systemInstruction, apiKeys, model, fetchImpl = globalThis.fetch }) {
  const orderedKeys = apiKeys || configuredApiKeys();
  const selectedModel = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;

  if (orderedKeys.length === 0) {
    throw new GeminiServiceError('Smart AI is not configured.', 503, 'GEMINI_NOT_CONFIGURED');
  }
  if (typeof fetchImpl !== 'function') {
    throw new GeminiServiceError('Smart AI transport is unavailable.', 503, 'GEMINI_TRANSPORT_UNAVAILABLE');
  }

  const requestBody = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 900,
    },
  };

  for (let keyIndex = 0; keyIndex < orderedKeys.length; keyIndex += 1) {
    let response;
    try {
      const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(orderedKeys[keyIndex])}`;
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (cause) {
      throw new GeminiServiceError(
        cause?.name === 'TimeoutError' ? 'Smart AI timed out.' : 'Smart AI could not be reached.',
        502,
        cause?.name === 'TimeoutError' ? 'GEMINI_TIMEOUT' : 'GEMINI_NETWORK_ERROR',
      );
    }

    const body = await readJson(response);
    if (response.ok) {
      const text = responseText(body);
      if (!text) {
        throw new GeminiServiceError('Smart AI returned an empty response.', 502, 'GEMINI_EMPTY_RESPONSE');
      }
      return { text, model: selectedModel };
    }

    if (isRateLimited(response, body)) {
      if (keyIndex < orderedKeys.length - 1) continue;
      throw new GeminiServiceError('Smart AI is busy. Please try again shortly.', 429, 'GEMINI_RATE_LIMITED');
    }

    const upstreamCode = body?.error?.status || body?.error?.code || response.status;
    console.error('Gemini request failed', { upstreamCode, httpStatus: response.status });
    throw new GeminiServiceError('Smart AI could not complete the request.', 502, 'GEMINI_UPSTREAM_ERROR');
  }

  throw new GeminiServiceError('Smart AI is busy. Please try again shortly.', 429, 'GEMINI_RATE_LIMITED');
}

module.exports = {
  DEFAULT_MODEL,
  GeminiServiceError,
  configuredApiKeys,
  generateContent,
  isRateLimited,
  responseText,
};
