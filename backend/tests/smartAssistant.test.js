'use strict';

const mockQueryItems = jest.fn();
const mockGenerateContent = jest.fn();

jest.mock('../src/utils/database', () => ({ queryItems: mockQueryItems }));
jest.mock('../src/utils/gemini', () => {
  class GeminiServiceError extends Error {
    constructor(message, statusCode, code) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return { generateContent: mockGenerateContent, GeminiServiceError };
});

const assistant = require('../src/handlers/smartAssistant');

function event(body) {
  return {
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: { sub: 'user-123' } } },
  };
}

function bodyOf(response) { return JSON.parse(response.body); }

describe('Smart AI tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryItems
      .mockResolvedValueOnce([{
        title: 'Cloud report', module_id: 'module-1', deadline: '2026-08-21T15:00:00.000Z',
        status: 'not_started', priority: 'high', estimated_hours: 6, progress_percentage: 0,
      }])
      .mockResolvedValueOnce([{ module_id: 'module-1', module_code: 'ICT2104', module_name: 'Cloud Computing' }]);
    mockGenerateContent.mockResolvedValue({ text: '1. Start the report outline.', model: 'test-model' });
  });

  test('rejects arbitrary chatbot prompts', async () => {
    const response = await assistant.handler(event({ prompt: 'Chat with me', include_context: true }));
    expect(response.statusCode).toBe(400);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test.each(['prioritize', 'today_plan', 'deadline_risks'])('runs the allowlisted %s tool', async (tool) => {
    const response = await assistant.handler(event({ tool, include_context: true }));
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response).data).toEqual(expect.objectContaining({ tool, context_used: true }));
    expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(`Tool: ${tool}`),
      systemInstruction: expect.stringContaining('not a chatbot'),
    }));
  });

  test('requires context consent and at least one incomplete task', async () => {
    let response = await assistant.handler(event({ tool: 'prioritize', include_context: false }));
    expect(response.statusCode).toBe(400);

    mockQueryItems.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    response = await assistant.handler(event({ tool: 'prioritize', include_context: true }));
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response).error).toMatch(/incomplete task/i);
  });
});
