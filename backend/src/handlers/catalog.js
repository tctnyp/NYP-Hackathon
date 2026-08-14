const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient, ORGANIZATIONS_TABLE, SCHOOLS_TABLE, CLASSES_TABLE } = require('../utils/database');
const { success, error, getUserId } = require('../utils/response');

async function list(tableName, filter, values) {
  const response = await docClient.send(new ScanCommand({ TableName: tableName, ...(filter ? { FilterExpression: filter, ExpressionAttributeValues: values } : {}) }));
  return response.Items || [];
}
exports.organizations = async (event) => {
  if (!getUserId(event)) return error('Unauthorized', 401);
  return success({ organizations: await list(ORGANIZATIONS_TABLE) });
};
exports.schools = async (event) => {
  if (!getUserId(event)) return error('Unauthorized', 401);
  const organizationId = event.queryStringParameters?.organization_id;
  return success({ schools: await list(SCHOOLS_TABLE, organizationId ? 'organization_id = :organizationId' : null, organizationId ? { ':organizationId': organizationId } : null) });
};
exports.classes = async (event) => {
  if (!getUserId(event)) return error('Unauthorized', 401);
  const schoolId = event.queryStringParameters?.school_id;
  return success({ classes: await list(CLASSES_TABLE, schoolId ? 'school_id = :schoolId' : null, schoolId ? { ':schoolId': schoolId } : null) });
};