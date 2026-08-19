'use strict';

const {
  GeminiServiceError,
  configuredApiKeys,
  generateContent,
} = require('../src/utils/gemini');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

describe('Gemini service', () => {
  test('reads configured keys in order and ignores empty values', () => {
    expect(configuredApiKeys({
      GEMINI_API_KEY_1: ' first ',
      GEMINI_API_KEY_2: '',
      GEMINI_API_KEY_3: 'third',
    })).toEqual(['first', 'third']);
  });

  test('uses the first key when it succeeds', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      candidates: [{ content: { parts: [{ text: 'A focused plan' }] } }],
    }));

    await expect(generateContent({
      prompt: 'Plan my week',
      systemInstruction: 'Help safely',
      apiKeys: ['key-one', 'key-two'],
      model: 'test-model',
      fetchImpl,
    })).resolves.toEqual({ text: 'A focused plan', model: 'test-model' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('key=key-one');
  });

  test('falls over to the next key after a 429 response', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }))
      .mockResolvedValueOnce(response(200, {
        candidates: [{ content: { parts: [{ text: 'Fallback worked' }] } }],
      }));

    const result = await generateContent({
      prompt: 'Prioritize tasks',
      systemInstruction: 'Help safely',
      apiKeys: ['key-one', 'key-two', 'key-three'],
      fetchImpl,
    });

    expect(result.text).toBe('Fallback worked');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('key=key-one');
    expect(fetchImpl.mock.calls[1][0]).toContain('key=key-two');
  });

  test('reports rate limiting only after every key is exhausted', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(429, {
      error: { status: 'RESOURCE_EXHAUSTED' },
    }));

    await expect(generateContent({
      prompt: 'Help',
      systemInstruction: 'Help safely',
      apiKeys: ['one', 'two', 'three'],
      fetchImpl,
    })).rejects.toMatchObject({
      statusCode: 429,
      code: 'GEMINI_RATE_LIMITED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('does not rotate keys for non-rate-limit failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(403, {
      error: { code: 403, status: 'PERMISSION_DENIED' },
    }));

    await expect(generateContent({
      prompt: 'Help',
      systemInstruction: 'Help safely',
      apiKeys: ['one', 'two'],
      fetchImpl,
    })).rejects.toBeInstanceOf(GeminiServiceError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('fails safely when no API keys are configured', async () => {
    await expect(generateContent({
      prompt: 'Help',
      systemInstruction: 'Help safely',
      apiKeys: [],
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'GEMINI_NOT_CONFIGURED',
    });
  });
});
