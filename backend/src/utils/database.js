const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TASKS_TABLE = process.env.TASKS_TABLE || 'academic-tasks';
const USERS_TABLE = process.env.USERS_TABLE || 'academic-task-users';
const ORGANIZATIONS_TABLE = process.env.ORGANIZATIONS_TABLE || 'academic-organizations';
const SCHOOLS_TABLE = process.env.SCHOOLS_TABLE || 'academic-schools';
const CLASSES_TABLE = process.env.CLASSES_TABLE || 'academic-classes';
const ENROLLMENTS_TABLE = process.env.ENROLLMENTS_TABLE || 'academic-user-classes';

/**
 * Get item from DynamoDB
 */
async function getItem(tableName, key) {
  const command = new GetCommand({
    TableName: tableName,
    Key: key,
  });
  const response = await docClient.send(command);
  return response.Item;
}

/**
 * Put item to DynamoDB
 */
async function putItem(tableName, item) {
  const command = new PutCommand({
    TableName: tableName,
    Item: item,
  });
  await docClient.send(command);
  return item;
}

/**
 * Update item in DynamoDB
 */
async function updateItem(tableName, key, updates) {
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.entries(updates).forEach(([field, value], index) => {
    const nameKey = `#field${index}`;
    const valueKey = `:value${index}`;
    updateExpressions.push(`${nameKey} = ${valueKey}`);
    expressionAttributeNames[nameKey] = field;
    expressionAttributeValues[valueKey] = value;
  });

  const command = new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  });

  const response = await docClient.send(command);
  return response.Attributes;
}

/**
 * Delete item from DynamoDB
 */
async function deleteItem(tableName, key) {
  const command = new DeleteCommand({
    TableName: tableName,
    Key: key,
  });
  await docClient.send(command);
}

/**
 * Query items from DynamoDB
 */
async function queryItems(params) {
  const command = new QueryCommand({
    TableName: TASKS_TABLE,
    ...params,
  });
  const response = await docClient.send(command);
  return response.Items || [];
}

/**
 * Scan items from DynamoDB
 */
async function scanItems(params) {
  const command = new ScanCommand({
    TableName: TASKS_TABLE,
    ...params,
  });
  const response = await docClient.send(command);
  return response.Items || [];
}

/**
 * Batch write items
 */
async function batchWrite(items) {
  const chunks = [];
  for (let i = 0; i < items.length; i += 25) {
    chunks.push(items.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const command = new BatchWriteCommand({
      RequestItems: {
        [TASKS_TABLE]: chunk,
      },
    });
    await docClient.send(command);
  }
}

/**
 * Generate ISO timestamp
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Generate UUID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  docClient,
  TASKS_TABLE,
  USERS_TABLE,
  ORGANIZATIONS_TABLE,
  SCHOOLS_TABLE,
  CLASSES_TABLE,
  ENROLLMENTS_TABLE,
  getItem,
  putItem,
  updateItem,
  deleteItem,
  queryItems,
  scanItems,
  batchWrite,
  timestamp,
  generateId,
};
