const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, ENROLLMENTS_TABLE, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody, validateRequired } = require('../utils/response');
exports.list = async (event) => {
  const userId = getUserId(event);
  if (!userId) return error('Unauthorized', 401);
  const response = await docClient.send(new QueryCommand({ TableName: ENROLLMENTS_TABLE, KeyConditionExpression: 'user_id = :userId', ExpressionAttributeValues: { ':userId': userId } }));
  return success({ enrollments: response.Items || [] });
};
exports.enroll = async (event) => {
  const userId = getUserId(event);
  if (!userId) return error('Unauthorized', 401);
  const body = parseBody(event);
  const missing = body && validateRequired(body, ['class_id']);
  if (!body || missing) return error('class_id is required', 400);
  const item = { user_id: userId, class_id: body.class_id, organization_id: body.organization_id || null, school_id: body.school_id || null, role: body.role || 'student', enrolled_at: timestamp() };
  await docClient.send(new PutCommand({ TableName: ENROLLMENTS_TABLE, Item: item }));
  return success({ enrollment: item }, 201);
};