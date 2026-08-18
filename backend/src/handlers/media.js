const { success, error, getUserId, parseBody } = require('../utils/response');
const {
  MediaError,
  createUpload,
  deleteOwnedMedia,
  promoteUpload,
  signedMediaUrl,
} = require('../utils/mediaStorage');

function requestBody(event) {
  const body = parseBody(event);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MediaError('Invalid JSON body', 400);
  return body;
}

function route(event) {
  const method = event?.httpMethod || event?.requestContext?.http?.method || '';
  const path = event?.resource || event?.rawPath || event?.path || '';
  return `${method.toUpperCase()} ${path}`;
}

exports.handler = async (event) => {
  const userId = getUserId(event);
  if (!userId) return error('Unauthorized', 401);

  try {
    const body = requestBody(event);
    switch (route(event)) {
      case 'POST /media/uploads':
        return success(await createUpload(userId, body), 201);
      case 'POST /media/complete': {
        if (body.purpose !== 'background') throw new MediaError('Only background uploads can be completed directly', 400);
        const promoted = await promoteUpload(userId, body.object_key, body.purpose);
        const access = await signedMediaUrl(userId, promoted.objectKey, body.purpose);
        return success({ object_key: promoted.objectKey, media_type: promoted.mediaType, size: promoted.size, access_url: access.url, expires_in: access.expiresIn });
      }
      case 'POST /media/resolve': {
        const access = await signedMediaUrl(userId, body.object_key, 'background');
        return success({ object_key: body.object_key, access_url: access.url, media_type: access.mediaType, size: access.size, expires_in: access.expiresIn });
      }
      case 'DELETE /media': {
        const purpose = body.purpose;
        if (!['profile_photo', 'background', 'assignment_import'].includes(purpose)) throw new MediaError('Unsupported upload purpose', 400);
        await deleteOwnedMedia(userId, body.object_key, purpose, body.temporary !== true);
        return success({ deleted: true });
      }
      default:
        return error('Media endpoint not found', 404);
    }
  } catch (err) {
    if (err instanceof MediaError) return error(err.message, err.statusCode);
    console.error('Media operation failed', { category: String(err?.name || 'ServiceError').slice(0, 64) });
    return error('Media storage is temporarily unavailable', 503);
  }
};
