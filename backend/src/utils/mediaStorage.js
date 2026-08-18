const { createHash, randomUUID } = require('node:crypto');
const {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: process.env.REGION || process.env.AWS_REGION || 'us-east-1' });
const MEDIA_BUCKET = process.env.MEDIA_BUCKET || '';
const ABSOLUTE_MAX_BYTES = (100 * 1024 * 1024) - 1;
const UPLOAD_EXPIRES_SECONDS = 5 * 60;
const ACCESS_EXPIRES_SECONDS = 15 * 60;

const PURPOSES = Object.freeze({
  profile_photo: {
    maxBytes: 1024 * 1024,
    mediaTypes: Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }),
  },
  background: {
    maxBytes: 5 * 1024 * 1024,
    mediaTypes: Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }),
  },
  assignment_import: {
    maxBytes: 4 * 1024 * 1024,
    mediaTypes: Object.freeze({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'application/pdf': 'pdf',
      'image/tiff': 'tiff',
    }),
  },
});

class MediaError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function requireBucket() {
  if (!MEDIA_BUCKET) throw new MediaError('Media storage is not configured', 503);
}

function ownerHash(userId) {
  if (typeof userId !== 'string' || !userId) throw new MediaError('Unauthorized', 401);
  return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 40);
}

function purposeConfig(purpose) {
  const config = typeof purpose === 'string' ? PURPOSES[purpose] : null;
  if (!config) throw new MediaError('Unsupported upload purpose', 400);
  return config;
}

function canonicalChecksum(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new MediaError('A valid SHA-256 checksum is required', 400);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) {
    throw new MediaError('A valid SHA-256 checksum is required', 400);
  }
  return value;
}

function validateUploadRequest({ purpose, media_type: mediaType, file_size: fileSize, sha256_base64: checksum }) {
  const config = purposeConfig(purpose);
  const size = Number(fileSize);
  if (!Number.isInteger(size) || size < 1) throw new MediaError('File size must be a positive integer', 400);
  if (size > ABSOLUTE_MAX_BYTES || size > config.maxBytes) {
    throw new MediaError(`File exceeds the ${Math.floor(config.maxBytes / (1024 * 1024))} MiB limit`, 413);
  }
  if (typeof mediaType !== 'string' || !config.mediaTypes[mediaType.toLowerCase()]) {
    throw new MediaError('Unsupported media type for this upload', 415);
  }
  return { config, mediaType: mediaType.toLowerCase(), size, checksum: canonicalChecksum(checksum) };
}

function temporaryPrefix(userId, purpose) {
  return `uploads/${ownerHash(userId)}/${purpose}/`;
}

function durablePrefix(userId, purpose) {
  return `media/${ownerHash(userId)}/${purpose}/`;
}

function assertOwnedKey(userId, key, purpose, durable) {
  purposeConfig(purpose);
  const prefix = durable ? durablePrefix(userId, purpose) : temporaryPrefix(userId, purpose);
  if (typeof key !== 'string' || key.length > 512 || !key.startsWith(prefix) || !/^[A-Za-z0-9/_.-]+$/.test(key)) {
    throw new MediaError('Invalid media reference', 400);
  }
  return key;
}

function copySource(key) {
  return `${MEDIA_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function createUpload(userId, request) {
  requireBucket();
  const { config, mediaType, size, checksum } = validateUploadRequest(request);
  const purpose = request.purpose;
  const extension = config.mediaTypes[mediaType];
  const key = `${temporaryPrefix(userId, purpose)}${randomUUID()}.${extension}`;
  const owner = ownerHash(userId);
  const fields = {
    key,
    'Content-Type': mediaType,
    'success_action_status': '201',
    'x-amz-server-side-encryption': 'AES256',
    'x-amz-checksum-sha256': checksum,
    'x-amz-meta-owner': owner,
    'x-amz-meta-purpose': purpose,
    'x-amz-meta-checksum': checksum,
  };
  const signed = await createPresignedPost(s3, {
    Bucket: MEDIA_BUCKET,
    Key: key,
    Expires: UPLOAD_EXPIRES_SECONDS,
    Fields: fields,
    Conditions: [
      ['content-length-range', 1, Math.min(config.maxBytes, ABSOLUTE_MAX_BYTES)],
      ['eq', '$Content-Type', mediaType],
      ['eq', '$x-amz-server-side-encryption', 'AES256'],
      ['eq', '$x-amz-checksum-sha256', checksum],
      ['eq', '$x-amz-meta-owner', owner],
      ['eq', '$x-amz-meta-purpose', purpose],
      ['eq', '$x-amz-meta-checksum', checksum],
    ],
  });
  return {
    upload_url: signed.url,
    fields: signed.fields,
    object_key: key,
    max_bytes: Math.min(config.maxBytes, ABSOLUTE_MAX_BYTES),
    expires_in: UPLOAD_EXPIRES_SECONDS,
    expected_size: size,
  };
}

function validMagic(mediaType, bytes) {
  if (mediaType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mediaType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mediaType === 'application/pdf') return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mediaType === 'image/tiff') return bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a));
  return false;
}

async function readPrefix(key) {
  const response = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, Range: 'bytes=0-15' }));
  if (!response.Body) return Buffer.alloc(0);
  if (typeof response.Body.transformToByteArray === 'function') return Buffer.from(await response.Body.transformToByteArray());
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function validateObject(userId, key, purpose, durable = false) {
  requireBucket();
  assertOwnedKey(userId, key, purpose, durable);
  const config = purposeConfig(purpose);
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, ChecksumMode: 'ENABLED' }));
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) throw new MediaError('Uploaded file was not found', 400);
    throw err;
  }
  const mediaType = String(head.ContentType || '').toLowerCase();
  const length = Number(head.ContentLength || 0);
  const expectedOwner = ownerHash(userId);
  if (!config.mediaTypes[mediaType]
    || length < 1
    || length > config.maxBytes
    || length > ABSOLUTE_MAX_BYTES
    || head.Metadata?.owner !== expectedOwner
    || head.Metadata?.purpose !== purpose
    || !head.Metadata?.checksum
    || (head.ChecksumSHA256 && head.ChecksumSHA256 !== head.Metadata.checksum)) {
    throw new MediaError('Uploaded file failed validation', 400);
  }
  const prefix = await readPrefix(key);
  if (!validMagic(mediaType, prefix)) throw new MediaError('Uploaded file content does not match its media type', 415);
  return { key, mediaType, length, checksum: head.Metadata.checksum, versionId: head.VersionId };
}

async function promoteUpload(userId, key, purpose) {
  const object = await validateObject(userId, key, purpose, false);
  const extension = purposeConfig(purpose).mediaTypes[object.mediaType];
  const destination = `${durablePrefix(userId, purpose)}${randomUUID()}.${extension}`;
  const copied = await s3.send(new CopyObjectCommand({
    Bucket: MEDIA_BUCKET,
    Key: destination,
    CopySource: copySource(key),
    MetadataDirective: 'COPY',
    ServerSideEncryption: 'AES256',
    ChecksumAlgorithm: 'SHA256',
  }));
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      ...(object.versionId ? { VersionId: object.versionId } : {}),
    }));
  } catch (deleteError) {
    await s3.send(new DeleteObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: destination,
      ...(copied?.VersionId ? { VersionId: copied.VersionId } : {}),
    })).catch(() => {});
    throw deleteError;
  }
  return { objectKey: destination, mediaType: object.mediaType, size: object.length };
}

async function signedMediaUrl(userId, key, purpose) {
  const object = await validateObject(userId, key, purpose, true);
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: MEDIA_BUCKET,
    Key: key,
    ResponseContentType: object.mediaType,
    ResponseContentDisposition: 'inline',
  }), { expiresIn: ACCESS_EXPIRES_SECONDS });
  return { url, mediaType: object.mediaType, size: object.length, expiresIn: ACCESS_EXPIRES_SECONDS };
}

async function deleteOwnedMedia(userId, key, purpose, durable = true) {
  requireBucket();
  assertOwnedKey(userId, key, purpose, durable);
  await s3.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
}

module.exports = {
  ABSOLUTE_MAX_BYTES,
  ACCESS_EXPIRES_SECONDS,
  MediaError,
  PURPOSES,
  createUpload,
  deleteOwnedMedia,
  promoteUpload,
  signedMediaUrl,
  validateObject,
  _test: { assertOwnedKey, canonicalChecksum, ownerHash, validMagic, validateUploadRequest },
};
