const { TextractClient, AnalyzeDocumentCommand } = require('@aws-sdk/client-textract');
const { success, error, getUserId, parseBody } = require('../utils/response');
const { MediaError, deleteOwnedMedia, validateObject } = require('../utils/mediaStorage');

const textractClient = new TextractClient({ region: process.env.REGION || process.env.AWS_REGION });
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_BYTES / 3);
const MAX_BLOCKS = 5000;
const MAX_LINES = 300;
const MAX_TEXT = 500;
const FIELD_NAMES = [
  'title', 'description', 'task_type', 'deadline_local', 'estimated_hours',
  'grade_weight', 'is_group_work', 'module_hint',
];
const MEDIA = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { extensions: ['png'], magic: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'application/pdf': { extensions: ['pdf'], magic: (b) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-' },
  'image/tiff': { extensions: ['tif', 'tiff'], magic: (b) => b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) },
};
const LABELS = {
  title: ['title', 'task title', 'assignment title', 'assessment title', 'name'],
  description: ['description', 'details', 'instructions', 'task description'],
  task_type: ['task type', 'assessment type', 'type'],
  deadline_local: ['deadline', 'due date', 'deadline date', 'submission date', 'due'],
  estimated_hours: ['estimated hours', 'hours', 'estimated time', 'duration'],
  grade_weight: ['grade weight', 'weightage', 'weight', 'percentage'],
  is_group_work: ['group work', 'group assignment', 'team assignment', 'individual or group'],
  module_hint: ['module', 'module code', 'course', 'course code', 'subject'],
};

function apiError(message, statusCode) {
  return error(message, statusCode);
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: apiError('Invalid JSON body', 400) };
  const { file_name: fileName, media_type: mediaType, object_key: objectKey, locale } = body;
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255
    || typeof mediaType !== 'string' || typeof objectKey !== 'string' || !objectKey) {
    return { response: apiError('file_name, media_type and object_key are required', 400) };
  }
  if (locale !== undefined && (typeof locale !== 'string' || locale.length > 35)) {
    return { response: apiError('locale must be a valid locale string', 400) };
  }
  const normalizedMediaType = mediaType.toLowerCase();
  const format = MEDIA[normalizedMediaType];
  const extension = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!format || !extension || !format.extensions.includes(extension)) {
    return { response: apiError('Unsupported document type', 415) };
  }
  if (objectKey.length > 512 || !/^uploads\/[a-f0-9]{40}\/assignment_import\/[A-Za-z0-9_.-]+$/.test(objectKey)) {
    return { response: apiError('Invalid assignment upload reference', 400) };
  }
  return { objectKey, fileName: fileName.trim(), mediaType: normalizedMediaType, locale: locale || '' };
}function textForBlock(block, byId, depth = 0) {
  if (!block || depth > 2) return '';
  const ids = (block.Relationships || []).filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids || []).slice(0, 100);
  return ids.map((id) => byId.get(id)).filter(Boolean).map((child) => {
    if (child.BlockType === 'WORD') return child.Text || '';
    if (child.BlockType === 'SELECTION_ELEMENT') return child.SelectionStatus === 'SELECTED' ? 'yes' : 'no';
    return textForBlock(child, byId, depth + 1);
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function canonicalLabel(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function keyValuePairs(blocks, byId) {
  const pairs = [];
  for (const key of blocks) {
    if (key.BlockType !== 'KEY_VALUE_SET' || !(key.EntityTypes || []).includes('KEY')) continue;
    const label = canonicalLabel(textForBlock(key, byId));
    const valueIds = (key.Relationships || []).filter((r) => r.Type === 'VALUE').flatMap((r) => r.Ids || []).slice(0, 10);
    for (const valueId of valueIds) {
      const valueBlock = byId.get(valueId);
      const value = textForBlock(valueBlock, byId);
      if (label && value) pairs.push({ label, value, confidence: Math.min(Number(key.Confidence) || 0, Number(valueBlock?.Confidence) || Number(key.Confidence) || 0) });
    }
  }
  return pairs.slice(0, 200);
}

function candidate(field, pairs, lines) {
  const aliases = LABELS[field];
  const pair = pairs.find((item) => aliases.includes(item.label));
  if (pair) return pair;
  for (const line of lines) {
    const normalized = canonicalLabel(line.text);
    for (const alias of aliases) {
      const prefix = `${alias} `;
      if (normalized.startsWith(prefix)) {
        const raw = line.text.replace(new RegExp(`^\\s*${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-]?\\s*`, 'i'), '').trim();
        if (raw) return { value: raw.slice(0, MAX_TEXT), confidence: line.confidence };
      }
    }
  }
  return null;
}

function suggestion(value, confidence) {
  return { value, confidence: Math.max(0, Math.min(100, Math.round((Number(confidence) || 0) * 10) / 10)) };
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeDeadline(raw, locale, warnings) {
  const text = raw.trim().replace(/\s+/g, ' ');
  let year; let month; let day; let time = '';
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?:\s*(am|pm))?)?$/i);
  if (match) {
    [, year, month, day] = match.map((v, i) => i > 0 && i < 4 ? Number(v) : v);
    if (match[4]) time = normalizeTime(Number(match[4]), Number(match[5]), match[6]);
  } else {
    match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?)?$/i);
    if (!match) return null;
    const first = Number(match[1]); const second = Number(match[2]); year = Number(match[3]);
    const localeLower = locale.toLowerCase();
    const monthFirst = /^en-us\b/.test(localeLower);
    const dayFirst = /^(en-(sg|gb|au|nz)|ms|zh-sg)\b/.test(localeLower);
    if (first <= 12 && second <= 12 && first !== second && !monthFirst && !dayFirst) {
      warnings.push('deadline_ambiguous_numeric_date');
      return null;
    }
    if (monthFirst) { month = first; day = second; } else { day = first; month = second; }
    if (!monthFirst && !dayFirst && first <= 12 && second > 12) { month = first; day = second; }
    if (match[4]) time = normalizeTime(Number(match[4]), Number(match[5]), match[6]);
  }
  if (!validDate(Number(year), Number(month), Number(day)) || time === null) return null;
  if (!time) {
    time = '23:59';
    warnings.push('deadline_date_only_defaulted_to_23_59');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}`;
}

function normalizeTime(hour, minute, period) {
  if (minute > 59 || hour > (period ? 12 : 23) || hour < (period ? 1 : 0)) return null;
  let h = hour;
  if (period) {
    if (period.toLowerCase() === 'am' && h === 12) h = 0;
    if (period.toLowerCase() === 'pm' && h !== 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeField(field, item, locale, warnings) {
  if (!item) return null;
  const raw = item.value.trim().slice(0, MAX_TEXT);
  if (!raw) return null;
  let value = raw;
  if (field === 'task_type') {
    const normalized = raw.toLowerCase();
    value = ['assignment', 'test', 'exam', 'project', 'presentation', 'report', 'competition'].find((type) => normalized.includes(type)) || (normalized.includes('quiz') ? 'test' : 'other');
  } else if (field === 'deadline_local') {
    value = normalizeDeadline(raw, locale, warnings);
    if (!value) return null;
  } else if (field === 'estimated_hours') {
    const number = raw.match(/\d+(?:\.\d+)?/)?.[0];
    value = number ? Number(number) : null;
    if (value === null || value <= 0 || value > 10000) return null;
  } else if (field === 'grade_weight') {
    const number = raw.match(/\d+(?:\.\d+)?/)?.[0];
    value = number ? Number(number) : null;
    if (value === null || value < 0 || value > 100) return null;
  } else if (field === 'is_group_work') {
    const normalized = raw.toLowerCase();
    if (/\b(yes|group|team|true)\b/.test(normalized)) value = true;
    else if (/\b(no|individual|false)\b/.test(normalized)) value = false;
    else return null;
  }
  return suggestion(value, item.confidence);
}

function parseTextract(response, locale) {
  const blocks = Array.isArray(response?.Blocks) ? response.Blocks.slice(0, MAX_BLOCKS) : [];
  const pages = blocks.filter((block) => block.BlockType === 'PAGE').length;
  if (!pages) throw Object.assign(new Error('Unreadable document'), { statusCode: 422, publicMessage: 'Document could not be read' });
  if (pages > 1) throw Object.assign(new Error('Multipage document'), { statusCode: 422, publicMessage: 'Multipage documents are not supported' });
  const byId = new Map(blocks.filter((block) => block.Id).map((block) => [block.Id, block]));
  const pairs = keyValuePairs(blocks, byId);
  const lines = blocks.filter((block) => block.BlockType === 'LINE' && block.Text).slice(0, MAX_LINES).map((block) => ({ text: String(block.Text).slice(0, MAX_TEXT), confidence: block.Confidence }));
  if (!pairs.length && !lines.length) throw Object.assign(new Error('Unreadable document'), { statusCode: 422, publicMessage: 'Document could not be read' });
  const warnings = [];
  const fields = {};
  for (const field of FIELD_NAMES) fields[field] = normalizeField(field, candidate(field, pairs, lines), locale, warnings);
  return { fields, warnings: [...new Set(warnings)].slice(0, 10), document: { pages } };
}

function serviceError(err) {
  if (['ThrottlingException', 'ProvisionedThroughputExceededException', 'LimitExceededException'].includes(err?.name)) return apiError('Document analysis is busy; try again later', 429);
  if (['DocumentTooLargeException'].includes(err?.name)) return apiError('Document exceeds the service limit', 413);
  if (['BadDocumentException', 'UnsupportedDocumentException'].includes(err?.name)) return apiError('Document could not be read or contains multiple pages', 422);
  return apiError('Document analysis service is unavailable', 503);
}

exports.handler = async (event) => {
  const userId = getUserId(event);
  if (!userId) return apiError('Unauthorized', 401);
  const validated = validateRequest(parseBody(event));
  if (validated.response) return validated.response;

  let uploaded;
  try {
    uploaded = await validateObject(userId, validated.objectKey, 'assignment_import', false);
    if (uploaded.mediaType !== validated.mediaType) return apiError('Document content type does not match the upload', 415);
    const result = await textractClient.send(new AnalyzeDocumentCommand({
      Document: {
        S3Object: {
          Bucket: process.env.MEDIA_BUCKET,
          Name: uploaded.key,
          ...(uploaded.versionId ? { Version: uploaded.versionId } : {}),
        },
      },
      FeatureTypes: ['FORMS'],
    }));
    return success(parseTextract(result, validated.locale));
  } catch (err) {
    if (err instanceof MediaError) return apiError(err.message, err.statusCode);
    if (err?.statusCode && err?.publicMessage) return apiError(err.publicMessage, err.statusCode);
    console.error('Task extraction failed', { category: String(err?.name || 'ServiceError').slice(0, 64) });
    return serviceError(err);
  } finally {
    if (uploaded?.key) {
      await deleteOwnedMedia(userId, uploaded.key, 'assignment_import', false).catch(() => {});
    }
  }
};

exports._test = { normalizeDeadline, parseTextract, validateRequest };