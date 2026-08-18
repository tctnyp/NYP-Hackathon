const mockTextractSend = jest.fn();

jest.mock('@aws-sdk/client-textract', () => {
  class AnalyzeDocumentCommand { constructor(input) { this.input = input; } }
  return { TextractClient: jest.fn(() => ({ send: mockTextractSend })), AnalyzeDocumentCommand };
}, { virtual: true });

const extraction = require('../src/handlers/taskExtraction');

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function event(overrides = {}, authenticated = true) {
  return {
    requestContext: authenticated ? { authorizer: { claims: { sub: 'user-123' } } } : {},
    body: JSON.stringify({ file_name: 'brief.png', media_type: 'image/png', document_base64: PNG.toString('base64'), ...overrides }),
  };
}
function body(response) { return JSON.parse(response.body); }
function word(id, text) { return { Id: id, BlockType: 'WORD', Text: text }; }
function kv(keyId, valueId, labelWords, valueWords, confidence = 96) {
  const keyWordIds = labelWords.map((_, i) => `${keyId}-w${i}`);
  const valueWordIds = valueWords.map((_, i) => `${valueId}-w${i}`);
  return [
    { Id: keyId, BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: confidence, Relationships: [{ Type: 'CHILD', Ids: keyWordIds }, { Type: 'VALUE', Ids: [valueId] }] },
    { Id: valueId, BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Confidence: confidence - 1, Relationships: [{ Type: 'CHILD', Ids: valueWordIds }] },
    ...labelWords.map((text, i) => word(keyWordIds[i], text)),
    ...valueWords.map((text, i) => word(valueWordIds[i], text)),
  ];
}
function responseBlocks(extra = []) { return { Blocks: [{ Id: 'page', BlockType: 'PAGE', Page: 1 }, ...extra] }; }

describe('POST /task-extractions', () => {
  let consoleError;
  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  test('requires a Cognito user before reading or sending a document', async () => {
    const response = await extraction.handler(event({}, false));
    expect(response.statusCode).toBe(401);
    expect(mockTextractSend).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', { ...event(), body: '{' }, 400],
    ['missing required field', event({ document_base64: undefined }), 400],
    ['data URL', event({ document_base64: `data:image/png;base64,${PNG.toString('base64')}` }), 400],
    ['base64 whitespace', event({ document_base64: `${PNG.toString('base64')}\n` }), 400],
    ['URL-safe base64', event({ document_base64: '____' }), 400],
    ['unsupported media', event({ media_type: 'image/gif', file_name: 'brief.gif' }), 415],
    ['extension mismatch', event({ file_name: 'brief.pdf' }), 415],
    ['magic mismatch', event({ document_base64: Buffer.from('%PDF-x').toString('base64') }), 415],
  ])('maps %s to %i', async (_name, request, status) => {
    const response = await extraction.handler(request);
    expect(response.statusCode).toBe(status);
    expect(mockTextractSend).not.toHaveBeenCalled();
  });

  test('rejects a decoded document above 4 MiB with 413', async () => {
    const oversized = Buffer.alloc((4 * 1024 * 1024) + 1, 1).toString('base64');
    const response = await extraction.handler(event({ document_base64: oversized }));
    expect(response.statusCode).toBe(413);
    expect(mockTextractSend).not.toHaveBeenCalled();
  });

  test.each([
    ['photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 1])],
    ['brief.png', 'image/png', PNG],
    ['brief.pdf', 'application/pdf', Buffer.from('%PDF-1.7')],
    ['scan.tiff', 'image/tiff', Buffer.from([0x49, 0x49, 0x2a, 0x00, 1])],
  ])('accepts valid %s bytes and sends only AnalyzeDocument FORMS', async (fileName, mediaType, bytes) => {
    mockTextractSend.mockResolvedValue(responseBlocks([{ Id: 'line', BlockType: 'LINE', Text: 'Title: Test brief', Confidence: 90 }]));
    const response = await extraction.handler(event({ file_name: fileName, media_type: mediaType, document_base64: bytes.toString('base64') }));
    expect(response.statusCode).toBe(200);
    const input = mockTextractSend.mock.calls[0][0].input;
    expect(input.FeatureTypes).toEqual(['FORMS']);
    expect(Buffer.from(input.Document.Bytes)).toEqual(bytes);
    expect(input).not.toHaveProperty('S3Object');
  });

  test('extracts bounded normalized suggestions from Textract key-values without raw OCR or difficulty', async () => {
    const blocks = [
      ...kv('k1', 'v1', ['Task', 'Title'], ['Cloud', 'Report']),
      ...kv('k2', 'v2', ['Description'], ['Review', 'architecture']),
      ...kv('k3', 'v3', ['Assessment', 'Type'], ['Presentation']),
      ...kv('k4', 'v4', ['Due', 'Date'], ['18/09/2026']),
      ...kv('k5', 'v5', ['Estimated', 'Hours'], ['6.5', 'hours']),
      ...kv('k6', 'v6', ['Weightage'], ['25%']),
      ...kv('k7', 'v7', ['Group', 'Work'], ['Yes']),
      ...kv('k8', 'v8', ['Module', 'Code'], ['ICT2104']),
      ...kv('k9', 'v9', ['Difficulty'], ['Hard']),
    ];
    mockTextractSend.mockResolvedValue(responseBlocks(blocks));
    const response = await extraction.handler(event({ locale: 'en-SG' }));
    expect(response.statusCode).toBe(200);
    const data = body(response).data;
    expect(data.fields).toEqual({
      title: { value: 'Cloud Report', confidence: 95 },
      description: { value: 'Review architecture', confidence: 95 },
      task_type: { value: 'presentation', confidence: 95 },
      deadline_local: { value: '2026-09-18T23:59', confidence: 95 },
      estimated_hours: { value: 6.5, confidence: 95 },
      grade_weight: { value: 25, confidence: 95 },
      is_group_work: { value: true, confidence: 95 },
      module_hint: { value: 'ICT2104', confidence: 95 },
    });
    expect(data.warnings).toEqual(['deadline_date_only_defaulted_to_23_59']);
    expect(data.document).toEqual({ pages: 1 });
    expect(response.body).not.toContain('Blocks');
    expect(response.body).not.toContain('Difficulty');
    expect(Object.keys(data.fields)).not.toContain('difficulty');
  });

  test('uses bounded line fallback and returns null for absent fields', async () => {
    mockTextractSend.mockResolvedValue(responseBlocks([
      { Id: 'l1', BlockType: 'LINE', Text: 'Title: Networking quiz', Confidence: 88.44 },
      { Id: 'l2', BlockType: 'LINE', Text: 'Task Type - quiz', Confidence: 87 },
    ]));
    const data = body(await extraction.handler(event())).data;
    expect(data.fields.title).toEqual({ value: 'Networking quiz', confidence: 88.4 });
    expect(data.fields.task_type.value).toBe('test');
    expect(data.fields.deadline_local).toBeNull();
  });

  test('rejects ambiguous numeric dates unless locale resolves order', () => {
    const warnings = [];
    expect(extraction._test.normalizeDeadline('03/04/2027', '', warnings)).toBeNull();
    expect(warnings).toContain('deadline_ambiguous_numeric_date');
    expect(extraction._test.normalizeDeadline('03/04/2027', 'en-SG', [])).toBe('2027-04-03T23:59');
    expect(extraction._test.normalizeDeadline('03/04/2027', 'en-US', [])).toBe('2027-03-04T23:59');
  });

  test.each([
    ['no readable page', { Blocks: [] }, 422],
    ['multiple pages', { Blocks: [{ Id: 'p1', BlockType: 'PAGE' }, { Id: 'p2', BlockType: 'PAGE' }] }, 422],
  ])('maps %s to 422', async (_name, textractResponse, status) => {
    mockTextractSend.mockResolvedValue(textractResponse);
    expect((await extraction.handler(event())).statusCode).toBe(status);
  });

  test.each([
    ['ThrottlingException', 429],
    ['ProvisionedThroughputExceededException', 429],
    ['DocumentTooLargeException', 413],
    ['BadDocumentException', 422],
    ['UnsupportedDocumentException', 422],
    ['AccessDeniedException', 503],
    ['InternalServerError', 503],
  ])('maps Textract %s to %i without leaking service details', async (name, status) => {
    mockTextractSend.mockRejectedValue(Object.assign(new Error('sensitive OCR or permission details'), { name }));
    const response = await extraction.handler(event());
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain('sensitive');
    expect(response.body).not.toContain(name);
    expect(consoleError).toHaveBeenCalledWith('Task extraction failed', { category: name });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive OCR');
  });
});
