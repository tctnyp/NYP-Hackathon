const mockTextractSend = jest.fn();
const mockValidateObject = jest.fn();
const mockDeleteOwnedMedia = jest.fn();

jest.mock('@aws-sdk/client-textract', () => {
  class AnalyzeDocumentCommand { constructor(input) { this.input = input; } }
  return { TextractClient: jest.fn(() => ({ send: mockTextractSend })), AnalyzeDocumentCommand };
}, { virtual: true });

jest.mock('../src/utils/mediaStorage', () => {
  class MediaError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    validateObject: mockValidateObject,
    deleteOwnedMedia: mockDeleteOwnedMedia,
    MediaError,
  };
});

process.env.MEDIA_BUCKET = 'test-media-bucket';

const { MediaError } = require('../src/utils/mediaStorage');
const extraction = require('../src/handlers/taskExtraction');

const OWNER = 'a'.repeat(40);
const OBJECT_KEY = `uploads/${OWNER}/assignment_import/brief.png`;
const VERSION_ID = 'version-123';

function event(overrides = {}, authenticated = true) {
  return {
    requestContext: authenticated ? { authorizer: { claims: { sub: 'user-123' } } } : {},
    body: JSON.stringify({
      file_name: 'brief.png',
      media_type: 'image/png',
      object_key: OBJECT_KEY,
      ...overrides,
    }),
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

function expectCleanup(key = OBJECT_KEY) {
  expect(mockDeleteOwnedMedia).toHaveBeenCalledTimes(1);
  expect(mockDeleteOwnedMedia).toHaveBeenCalledWith('user-123', key, 'assignment_import', false);
}

describe('POST /task-extractions', () => {
  let consoleError;

  beforeEach(() => {
    mockTextractSend.mockReset();
    mockValidateObject.mockReset();
    mockDeleteOwnedMedia.mockReset();
    mockValidateObject.mockResolvedValue({
      key: OBJECT_KEY,
      mediaType: 'image/png',
      length: 1234,
      checksum: 'checksum',
      versionId: VERSION_ID,
    });
    mockDeleteOwnedMedia.mockResolvedValue(undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  test('requires a Cognito user before validating or sending an object', async () => {
    const response = await extraction.handler(event({}, false));
    expect(response.statusCode).toBe(401);
    expect(mockValidateObject).not.toHaveBeenCalled();
    expect(mockTextractSend).not.toHaveBeenCalled();
    expect(mockDeleteOwnedMedia).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', { ...event(), body: '{' }, 400],
    ['missing object key', event({ object_key: undefined }), 400],
    ['missing file name', event({ file_name: undefined }), 400],
    ['missing media type', event({ media_type: undefined }), 400],
    ['unsupported media', event({ media_type: 'image/gif', file_name: 'brief.gif' }), 415],
    ['extension mismatch', event({ file_name: 'brief.pdf' }), 415],
    ['durable media reference', event({ object_key: `media/${OWNER}/assignment_import/brief.png` }), 400],
    ['wrong upload purpose', event({ object_key: `uploads/${OWNER}/profile_photo/brief.png` }), 400],
    ['unsafe object key', event({ object_key: `uploads/${OWNER}/assignment_import/../brief.png` }), 400],
  ])('rejects %s before media validation', async (_name, request, status) => {
    const response = await extraction.handler(request);
    expect(response.statusCode).toBe(status);
    expect(mockValidateObject).not.toHaveBeenCalled();
    expect(mockTextractSend).not.toHaveBeenCalled();
    expect(mockDeleteOwnedMedia).not.toHaveBeenCalled();
  });

  test.each([
    ['photo.jpg', 'image/jpeg'],
    ['brief.png', 'image/png'],
    ['brief.pdf', 'application/pdf'],
    ['scan.tiff', 'image/tiff'],
  ])('accepts an uploaded %s reference', async (fileName, mediaType) => {
    const key = `uploads/${OWNER}/assignment_import/${fileName}`;
    mockValidateObject.mockResolvedValue({ key, mediaType, versionId: VERSION_ID });
    mockTextractSend.mockResolvedValue(responseBlocks([
      { Id: 'line', BlockType: 'LINE', Text: 'Title: Test brief', Confidence: 90 },
    ]));

    const response = await extraction.handler(event({ file_name: fileName, media_type: mediaType, object_key: key }));

    expect(response.statusCode).toBe(200);
    expect(mockValidateObject).toHaveBeenCalledWith('user-123', key, 'assignment_import', false);
    expectCleanup(key);
  });

  test('uses the validated S3 Bucket, Name, and Version without base64 Bytes', async () => {
    const validatedKey = `uploads/${OWNER}/assignment_import/validated-name.png`;
    mockValidateObject.mockResolvedValue({
      key: validatedKey,
      mediaType: 'image/png',
      versionId: VERSION_ID,
    });
    mockTextractSend.mockResolvedValue(responseBlocks([
      { Id: 'line', BlockType: 'LINE', Text: 'Title: S3 brief', Confidence: 90 },
    ]));

    const response = await extraction.handler(event({ document_base64: 'must-not-be-used' }));

    expect(response.statusCode).toBe(200);
    expect(mockValidateObject).toHaveBeenCalledWith('user-123', OBJECT_KEY, 'assignment_import', false);
    expect(mockTextractSend).toHaveBeenCalledTimes(1);
    const input = mockTextractSend.mock.calls[0][0].input;
    expect(input).toEqual({
      Document: {
        S3Object: {
          Bucket: 'test-media-bucket',
          Name: validatedKey,
          Version: VERSION_ID,
        },
      },
      FeatureTypes: ['FORMS'],
    });
    expect(input.Document).not.toHaveProperty('Bytes');
    expect(JSON.stringify(input)).not.toContain('must-not-be-used');
    expectCleanup(validatedKey);
  });

  test('omits S3 Version when validation returns no version ID', async () => {
    mockValidateObject.mockResolvedValue({ key: OBJECT_KEY, mediaType: 'image/png' });
    mockTextractSend.mockResolvedValue(responseBlocks([
      { Id: 'line', BlockType: 'LINE', Text: 'Title: Current object', Confidence: 90 },
    ]));

    expect((await extraction.handler(event())).statusCode).toBe(200);
    const s3Object = mockTextractSend.mock.calls[0][0].input.Document.S3Object;
    expect(s3Object).toEqual({ Bucket: 'test-media-bucket', Name: OBJECT_KEY });
    expectCleanup();
  });

  test('rejects an owner-scoped reference reported by media storage', async () => {
    const foreignKey = `uploads/${'b'.repeat(40)}/assignment_import/brief.png`;
    mockValidateObject.mockRejectedValue(new MediaError('Invalid media reference', 400));

    const response = await extraction.handler(event({ object_key: foreignKey }));

    expect(response.statusCode).toBe(400);
    expect(body(response).error).toBe('Invalid media reference');
    expect(mockValidateObject).toHaveBeenCalledWith('user-123', foreignKey, 'assignment_import', false);
    expect(mockTextractSend).not.toHaveBeenCalled();
    expect(mockDeleteOwnedMedia).not.toHaveBeenCalled();
  });

  test('rejects validated media type mismatch and cleans up the upload', async () => {
    mockValidateObject.mockResolvedValue({ key: OBJECT_KEY, mediaType: 'application/pdf', versionId: VERSION_ID });

    const response = await extraction.handler(event());

    expect(response.statusCode).toBe(415);
    expect(body(response).error).toBe('Document content type does not match the upload');
    expect(mockTextractSend).not.toHaveBeenCalled();
    expectCleanup();
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
    expectCleanup();
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
    expectCleanup();
  });

  test('infers suggestions from an unstructured assignment brief and written deadline', async () => {
    mockTextractSend.mockResolvedValue(responseBlocks([
      { Id: 'l1', BlockType: 'LINE', Text: 'Cloud Architecture Risk Report', Confidence: 94 },
      { Id: 'l2', BlockType: 'LINE', Text: 'ICT2104 Enterprise Cloud Computing', Confidence: 92 },
      { Id: 'l3', BlockType: 'LINE', Text: 'Submission deadline: Friday, 21 August 2026, 11:59 PM', Confidence: 91 },
      { Id: 'l4', BlockType: 'LINE', Text: 'This group assignment is worth 30%', Confidence: 89 },
      { Id: 'l5', BlockType: 'LINE', Text: 'Expected workload: 8 hours', Confidence: 88 },
    ]));

    const data = body(await extraction.handler(event({ locale: 'en-SG' }))).data;

    expect(data.fields.title).toEqual({ value: 'Cloud Architecture Risk Report', confidence: 80 });
    expect(data.fields.module_hint).toEqual({ value: 'ICT2104', confidence: 80 });
    expect(data.fields.deadline_local).toEqual({ value: '2026-08-21T23:59', confidence: 91 });
    expect(data.fields.task_type.value).toBe('assignment');
    expect(data.fields.estimated_hours.value).toBe(8);
    expect(data.fields.grade_weight.value).toBe(30);
    expect(data.fields.is_group_work.value).toBe(true);
    expectCleanup();
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
  ])('maps %s to 422 and cleans up', async (_name, textractResponse, status) => {
    mockTextractSend.mockResolvedValue(textractResponse);

    expect((await extraction.handler(event())).statusCode).toBe(status);
    expectCleanup();
  });

  test.each([
    ['ThrottlingException', 429],
    ['ProvisionedThroughputExceededException', 429],
    ['LimitExceededException', 429],
    ['DocumentTooLargeException', 413],
    ['BadDocumentException', 422],
    ['UnsupportedDocumentException', 422],
    ['AccessDeniedException', 503],
    ['InternalServerError', 503],
  ])('maps Textract %s to %i without leaking details and cleans up', async (name, status) => {
    mockTextractSend.mockRejectedValue(Object.assign(new Error('sensitive OCR or permission details'), { name }));

    const response = await extraction.handler(event());

    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain('sensitive');
    expect(response.body).not.toContain(name);
    expect(consoleError).toHaveBeenCalledWith('Task extraction failed', { category: name });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sensitive OCR');
    expectCleanup();
  });

  test('swallows cleanup errors after successful extraction', async () => {
    mockTextractSend.mockResolvedValue(responseBlocks([
      { Id: 'line', BlockType: 'LINE', Text: 'Title: Cleanup test', Confidence: 90 },
    ]));
    mockDeleteOwnedMedia.mockRejectedValue(new Error('delete failed'));

    const response = await extraction.handler(event());

    expect(response.statusCode).toBe(200);
    expectCleanup();
  });
});
