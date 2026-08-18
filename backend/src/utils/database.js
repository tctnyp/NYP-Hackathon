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
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TASKS_TABLE = process.env.TASKS_TABLE || 'academic-tasks';
const USERS_TABLE = process.env.USERS_TABLE || 'academic-task-users';
const GROUPS_TABLE = process.env.GROUPS_TABLE || 'academic-groups';
const ORGANIZATIONS_TABLE = process.env.ORGANIZATIONS_TABLE || 'academic-organizations';
const SCHOOLS_TABLE = process.env.SCHOOLS_TABLE || 'academic-schools';
const CLASSES_TABLE = process.env.CLASSES_TABLE || 'academic-classes';
const ENROLLMENTS_TABLE = process.env.ENROLLMENTS_TABLE || 'academic-user-classes';

async function getItem(tableName, key, options = {}) {
  const response = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: key,
    ConsistentRead: options.consistentRead !== false,
  }));
  return response.Item;
}

async function putItem(tableName, item) {
  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

async function updateItem(tableName, key, updates, options = {}) {
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

  const response = await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: { ...expressionAttributeNames, ...(options.ExpressionAttributeNames || {}) },
    ExpressionAttributeValues: { ...expressionAttributeValues, ...(options.ExpressionAttributeValues || {}) },
    ConditionExpression: options.ConditionExpression,
    ReturnValues: 'ALL_NEW',
  }));
  return response.Attributes;
}

async function deleteItem(tableName, key, options = {}) {
  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: key,
    ConditionExpression: options.ConditionExpression,
    ExpressionAttributeNames: options.ExpressionAttributeNames,
    ExpressionAttributeValues: options.ExpressionAttributeValues,
  }));
}

async function queryTable(tableName, params) {
  const items = [];
  const limit = params.Limit;
  let exclusiveStartKey = params.ExclusiveStartKey;
  do {
    const remaining = limit ? limit - items.length : undefined;
    const response = await docClient.send(new QueryCommand({
      TableName: tableName,
      ...params,
      Limit: remaining,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(response.Items || []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey && (!limit || items.length < limit));
  return limit ? items.slice(0, limit) : items;
}

async function queryItems(params) {
  return queryTable(TASKS_TABLE, params);
}

async function scanTable(tableName, params = {}) {
  const items = [];
  let exclusiveStartKey;
  do {
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
      ...params,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(response.Items || []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function scanItems(params) {
  return scanTable(TASKS_TABLE, params);
}

async function transactWrite(transactItems) {
  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
}

async function batchWriteTable(tableName, requests) {
  for (let i = 0; i < requests.length; i += 25) {
    let pending = requests.slice(i, i + 25);
    do {
      const response = await docClient.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
      pending = response.UnprocessedItems?.[tableName] || [];
    } while (pending.length > 0);
  }
}

async function batchWrite(items) {
  return batchWriteTable(TASKS_TABLE, items);
}

function timestamp() {
  return new Date().toISOString();
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  docClient,
  TASKS_TABLE,
  USERS_TABLE,
  GROUPS_TABLE,
  ORGANIZATIONS_TABLE,
  SCHOOLS_TABLE,
  CLASSES_TABLE,
  ENROLLMENTS_TABLE,
  getItem,
  putItem,
  updateItem,
  deleteItem,
  queryTable,
  queryItems,
  scanTable,
  scanItems,
  transactWrite,
  batchWriteTable,
  batchWrite,
  timestamp,
  generateId,
};
