const { getItem, putItem, USERS_TABLE, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody } = require('../utils/response');

exports.getProfile = async (event) => {
  const userId = getUserId(event);
  if (!userId) return error('Unauthorized', 401);
  const profile = await getItem(USERS_TABLE, { user_id: userId });
  return success({ profile: profile || null });
};

exports.upsertProfile = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const body = parseBody(event);
    if (!body) return error('Invalid JSON body', 400);
    const existing = await getItem(USERS_TABLE, { user_id: userId });
    const now = timestamp();
    const profile = {
      ...(existing || {}),
      user_id: userId,
      email: existing?.email || process.env.DEFAULT_USER_EMAIL,
      full_name: body.full_name || existing?.full_name || 'Lab Demo User',
      organization_id: body.organization_id ?? existing?.organization_id ?? null,
      school_id: body.school_id ?? existing?.school_id ?? null,
      class_id: body.class_id ?? existing?.class_id ?? null,
      preferences: body.preferences ?? existing?.preferences ?? {},
      auth_provider: 'lab',
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    await putItem(USERS_TABLE, profile);
    return success({ profile }, existing ? 200 : 201);
  } catch (err) {
    console.error('Profile update failed:', err);
    return error('Failed to update profile', 500);
  }
};
