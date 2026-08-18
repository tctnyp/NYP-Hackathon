const { createHash } = require('node:crypto');

const mockS3Send = jest.fn();
const mockCreatePresignedPost = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class CopyObjectCommand { constructor(input) { this.input = input; } }
  class DeleteObjectCommand { constructor(input) { this.input = input; } }
  class GetObjectCommand { constructor(input) { this.input = input; } }
  class HeadObjectCommand { constructor(input) { this.input = input; } }
  class S3Client { constructor(config) { this.config = config; } send(command) { return mockS3Send(command); } }
  return { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client };
}, { virtual: true });

jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: (...args) => mockCreatePresignedPost(...args),
}), { virtual: true });

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args) => mockGetSignedUrl(...args),
}), { virtual: true });

process.env.MEDIA_BUCKET = 'private-media-test';
process.env.AWS_REGION = 'ap-southeast-1';

const {
  ABSOLUTE_MAX_BYTES,
  ACCESS_EXPIRES_SECONDS,
  MediaError,
  PURPOSES,
  createUpload,
  deleteOwnedMedia,
  promoteUpload,
  signedMediaUrl,
  validateObject,
  _test,
} = require('../src/utils/mediaStorage');
const mediaHandler = require('../src/handlers/media');
const {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const USER_ID = 'cognito|student@example.com';
const OTHER_USER_ID = 'cognito|other@example.com';
const CHECKSUM = Buffer.alloc(32, 0xa5).toString('base64');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

function ownerHash(userId = USER_ID) {
  return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 40);
}

function temporaryKey(purpose = 'background', name = 'upload.png', userId = USER_ID) {
  return `uploads/${ownerHash(userId)}/${purpose}/${name}`;
}

function durableKey(purpose = 'background', name = 'stored.png', userId = USER_ID) {
  return `media/${ownerHash(userId)}/${purpose}/${name}`;
}

function validHead(overrides = {}) {
  return {
    ContentType: 'image/png',
    ContentLength: PNG.length,
    Metadata: { owner: ownerHash(), purpose: 'background', checksum: CHECKSUM },
    ChecksumSHA256: CHECKSUM,
    VersionId: 'version-1',
    ...overrides,
  };
}

function byteBody(bytes = PNG) {
  return { transformToByteArray: jest.fn().mockResolvedValue(Uint8Array.from(bytes)) };
}

function authenticatedEvent(method, path, body, authenticated = true) {
  return {
    httpMethod: method,
    resource: path,
    requestContext: authenticated ? { authorizer: { claims: { sub: USER_ID } } } : {},
    body: JSON.stringify(body),
  };
}

function responseBody(response) {
  return JSON.parse(response.body);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreatePresignedPost.mockImplementation(async (_client, options) => ({
    url: 'https://private-media-test.s3.example/presigned-post',
    fields: options.Fields,
  }));
  mockGetSignedUrl.mockResolvedValue('https://signed.example/private-object?signature=secret');
  mockS3Send.mockImplementation(async (command) => {
    if (command instanceof HeadObjectCommand) return validHead();
    if (command instanceof GetObjectCommand) return { Body: byteBody() };
    return {};
  });
});

describe('mediaStorage upload validation and isolation', () => {
  test('enforces the absolute ceiling and every purpose-specific byte limit', () => {
    expect(ABSOLUTE_MAX_BYTES).toBe((100 * 1024 * 1024) - 1);

    const cases = [
      ['profile_photo', 'image/jpeg', 1024 * 1024],
      ['background', 'image/webp', 5 * 1024 * 1024],
      ['assignment_import', 'application/pdf', 4 * 1024 * 1024],
    ];
    for (const [purpose, mediaType, maxBytes] of cases) {
      expect(PURPOSES[purpose].maxBytes).toBe(maxBytes);
      expect(_test.validateUploadRequest({
        purpose,
        media_type: mediaType,
        file_size: maxBytes,
        sha256_base64: CHECKSUM,
      }).size).toBe(maxBytes);
      expect(() => _test.validateUploadRequest({
        purpose,
        media_type: mediaType,
        file_size: maxBytes + 1,
        sha256_base64: CHECKSUM,
      })).toThrow(expect.objectContaining({ statusCode: 413 }));
    }

    expect(() => _test.validateUploadRequest({
      purpose: 'background',
      media_type: 'image/png',
      file_size: ABSOLUTE_MAX_BYTES + 1,
      sha256_base64: CHECKSUM,
    })).toThrow(expect.objectContaining({ statusCode: 413 }));
  });

  test('requires a canonical base64 SHA-256 checksum', () => {
    expect(_test.canonicalChecksum(CHECKSUM)).toBe(CHECKSUM);
    for (const invalid of [undefined, '', CHECKSUM.slice(0, -1), `${CHECKSUM}\n`, '_'.repeat(43) + '=']) {
      expect(() => _test.canonicalChecksum(invalid)).toThrow(expect.objectContaining({
        message: 'A valid SHA-256 checksum is required',
        statusCode: 400,
      }));
    }
  });

  test('uses a fixed owner hash in keys and rejects cross-owner references', async () => {
    const expectedOwner = ownerHash();
    expect(_test.ownerHash(USER_ID)).toBe(expectedOwner);
    expect(expectedOwner).toHaveLength(40);
    expect(_test.ownerHash(OTHER_USER_ID)).not.toBe(expectedOwner);

    const ownKey = temporaryKey();
    expect(_test.assertOwnedKey(USER_ID, ownKey, 'background', false)).toBe(ownKey);
    expect(() => _test.assertOwnedKey(OTHER_USER_ID, ownKey, 'background', false)).toThrow('Invalid media reference');
    expect(() => _test.assertOwnedKey(USER_ID, durableKey(), 'background', false)).toThrow('Invalid media reference');

    const upload = await createUpload(USER_ID, {
      purpose: 'background', media_type: 'image/png', file_size: PNG.length, sha256_base64: CHECKSUM,
    });
    expect(upload.object_key).toMatch(new RegExp(`^uploads/${expectedOwner}/background/[0-9a-f-]+\\.png$`));
    expect(upload.object_key).not.toContain(USER_ID);
  });

  test('presigns an exact POST policy with encryption, checksum, metadata, and content length controls', async () => {
    const result = await createUpload(USER_ID, {
      purpose: 'profile_photo', media_type: 'IMAGE/PNG', file_size: PNG.length, sha256_base64: CHECKSUM,
    });
    expect(mockCreatePresignedPost).toHaveBeenCalledTimes(1);
    const options = mockCreatePresignedPost.mock.calls[0][1];
    const expectedFields = {
      key: result.object_key,
      'Content-Type': 'image/png',
      success_action_status: '201',
      'x-amz-server-side-encryption': 'AES256',
      'x-amz-checksum-sha256': CHECKSUM,
      'x-amz-meta-owner': ownerHash(),
      'x-amz-meta-purpose': 'profile_photo',
      'x-amz-meta-checksum': CHECKSUM,
    };
    expect(options).toEqual({
      Bucket: 'private-media-test',
      Key: result.object_key,
      Expires: 300,
      Fields: expectedFields,
      Conditions: [
        ['content-length-range', 1, 1024 * 1024],
        ['eq', '$Content-Type', 'image/png'],
        ['eq', '$x-amz-server-side-encryption', 'AES256'],
        ['eq', '$x-amz-checksum-sha256', CHECKSUM],
        ['eq', '$x-amz-meta-owner', ownerHash()],
        ['eq', '$x-amz-meta-purpose', 'profile_photo'],
        ['eq', '$x-amz-meta-checksum', CHECKSUM],
      ],
    });
    expect(result).toEqual({
      upload_url: 'https://private-media-test.s3.example/presigned-post',
      fields: expectedFields,
      object_key: result.object_key,
      max_bytes: 1024 * 1024,
      expires_in: 300,
      expected_size: PNG.length,
    });
  });
});

describe('mediaStorage object validation and private lifecycle', () => {
  test.each([
    ['image/png', PNG],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/webp', Buffer.from('RIFF1234WEBP', 'ascii')],
    ['application/pdf', Buffer.from('%PDF-1.7', 'ascii')],
    ['image/tiff little-endian', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
    ['image/tiff big-endian', Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
  ])('recognizes %s magic bytes', (mediaTypeLabel, bytes) => {
    const mediaType = mediaTypeLabel.split(' ')[0];
    expect(_test.validMagic(mediaType, bytes)).toBe(true);
    expect(_test.validMagic(mediaType, Buffer.from('not-the-format'))).toBe(false);
  });

  test('rejects an object whose bytes do not match its declared media type', async () => {
    mockS3Send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) return validHead();
      if (command instanceof GetObjectCommand) return { Body: byteBody(Buffer.from('GIF89a')) };
      return {};
    });
    await expect(validateObject(USER_ID, temporaryKey(), 'background')).rejects.toEqual(expect.objectContaining({
      message: 'Uploaded file content does not match its media type',
      statusCode: 415,
    }));
  });

  test('rejects checksum disagreement before reading object bytes', async () => {
    mockS3Send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) return validHead({ ChecksumSHA256: Buffer.alloc(32, 1).toString('base64') });
      return {};
    });
    await expect(validateObject(USER_ID, temporaryKey(), 'background')).rejects.toThrow('Uploaded file failed validation');
    expect(mockS3Send.mock.calls.some(([command]) => command instanceof GetObjectCommand)).toBe(false);
  });

  test('promotes using a bucket/key CopySource and deletes temporary data only after copy succeeds', async () => {
    const source = temporaryKey('background', 'source_file-1.png');
    const promoted = await promoteUpload(USER_ID, source, 'background');
    expect(promoted).toEqual({
      objectKey: expect.stringMatching(new RegExp(`^media/${ownerHash()}/background/[0-9a-f-]+\\.png$`)),
      mediaType: 'image/png',
      size: PNG.length,
    });

    const commands = mockS3Send.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.constructor.name)).toEqual([
      'HeadObjectCommand', 'GetObjectCommand', 'CopyObjectCommand', 'DeleteObjectCommand',
    ]);
    expect(commands[2].input).toEqual({
      Bucket: 'private-media-test',
      Key: promoted.objectKey,
      CopySource: `private-media-test/${source}`,
      MetadataDirective: 'COPY',
      ServerSideEncryption: 'AES256',
      ChecksumAlgorithm: 'SHA256',
    });
    expect(commands[3].input).toEqual({ Bucket: 'private-media-test', Key: source, VersionId: 'version-1' });
  });

  test('does not clean up the temporary object when promotion copy fails', async () => {
    mockS3Send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) return validHead();
      if (command instanceof GetObjectCommand) return { Body: byteBody() };
      if (command instanceof CopyObjectCommand) throw Object.assign(new Error('copy failed'), { name: 'CopyError' });
      return {};
    });
    await expect(promoteUpload(USER_ID, temporaryKey(), 'background')).rejects.toThrow('copy failed');
    expect(mockS3Send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  test('rolls back the copied durable version when temporary cleanup fails', async () => {
    let deleteCount = 0;
    mockS3Send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) return validHead();
      if (command instanceof GetObjectCommand) return { Body: byteBody() };
      if (command instanceof CopyObjectCommand) return { VersionId: 'copied-version' };
      if (command instanceof DeleteObjectCommand) {
        deleteCount += 1;
        if (deleteCount === 1) throw new Error('source delete failed');
        return {};
      }
      return {};
    });
    await expect(promoteUpload(USER_ID, temporaryKey(), 'background')).rejects.toThrow('source delete failed');
    const deletes = mockS3Send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectCommand);
    expect(deletes).toHaveLength(2);
    expect(deletes[1].input).toEqual(expect.objectContaining({
      Bucket: 'private-media-test',
      Key: expect.stringMatching(new RegExp(`^media/${ownerHash()}/background/`)),
      VersionId: 'copied-version',
    }));
  });

  test('validates a durable private key and returns only a short-lived signed inline GET', async () => {
    const key = durableKey();
    const result = await signedMediaUrl(USER_ID, key, 'background');
    expect(result).toEqual({
      url: 'https://signed.example/private-object?signature=secret',
      mediaType: 'image/png',
      size: PNG.length,
      expiresIn: ACCESS_EXPIRES_SECONDS,
    });
    expect(ACCESS_EXPIRES_SECONDS).toBe(15 * 60);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [client, command, options] = mockGetSignedUrl.mock.calls[0];
    expect(client).toBeDefined();
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'private-media-test',
      Key: key,
      ResponseContentType: 'image/png',
      ResponseContentDisposition: 'inline',
    });
    expect(options).toEqual({ expiresIn: 15 * 60 });
  });

  test('deleteOwnedMedia can explicitly address temporary rather than durable storage', async () => {
    const key = temporaryKey('assignment_import', 'brief.pdf');
    await deleteOwnedMedia(USER_ID, key, 'assignment_import', false);
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(mockS3Send.mock.calls[0][0].input).toEqual({ Bucket: 'private-media-test', Key: key });
  });
});

describe('media handler routing and error boundaries', () => {
  test('requires authentication before parsing or accessing storage', async () => {
    const response = await mediaHandler.handler(authenticatedEvent('POST', '/media/uploads', {}, false));
    expect(response.statusCode).toBe(401);
    expect(responseBody(response)).toMatchObject({ success: false, error: 'Unauthorized' });
    expect(mockCreatePresignedPost).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test('allows only background uploads to use direct completion', async () => {
    const response = await mediaHandler.handler(authenticatedEvent('POST', '/media/complete', {
      purpose: 'assignment_import', object_key: temporaryKey('assignment_import', 'brief.pdf'),
    }));
    expect(response.statusCode).toBe(400);
    expect(responseBody(response).error).toBe('Only background uploads can be completed directly');
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  test('uses durable=false when the handler deletes an explicitly temporary upload', async () => {
    const key = temporaryKey('profile_photo', 'discard.jpg');
    const response = await mediaHandler.handler(authenticatedEvent('DELETE', '/media', {
      purpose: 'profile_photo', object_key: key, temporary: true,
    }));
    expect(response.statusCode).toBe(200);
    expect(responseBody(response).data).toEqual({ deleted: true });
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockS3Send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(mockS3Send.mock.calls[0][0].input).toEqual({ Bucket: 'private-media-test', Key: key });
  });

  test('sanitizes unexpected storage errors in both logs and responses', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCreatePresignedPost.mockRejectedValue(Object.assign(
      new Error('secret bucket ARN and internal permission details'),
      { name: 'AccessDeniedException' },
    ));
    try {
      const response = await mediaHandler.handler(authenticatedEvent('POST', '/media/uploads', {
        purpose: 'background', media_type: 'image/png', file_size: PNG.length, sha256_base64: CHECKSUM,
      }));
      expect(response.statusCode).toBe(503);
      expect(responseBody(response).error).toBe('Media storage is temporarily unavailable');
      expect(response.body).not.toContain('secret bucket');
      expect(response.body).not.toContain('AccessDeniedException');
      expect(consoleError).toHaveBeenCalledWith('Media operation failed', { category: 'AccessDeniedException' });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret bucket');
    } finally {
      consoleError.mockRestore();
    }
  });

  test('returns MediaError messages while still rejecting malformed JSON safely', async () => {
    const event = authenticatedEvent('POST', '/media/uploads', {});
    event.body = '{not-json';
    const response = await mediaHandler.handler(event);
    expect(response.statusCode).toBe(400);
    expect(responseBody(response).error).toBe('Invalid JSON body');
    expect(mockCreatePresignedPost).not.toHaveBeenCalled();
  });
});
