const {
  CalendarSyncError,
  finishDisable,
  reconcileUserCalendar,
  revokeRefreshTokenIfConfigured,
  scanConnections,
  syncTaskForUser,
  deleteTaskForUser,
} = require('../utils/googleCalendarSync');

function dynamoValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, 'S')) return value.S;
  if (Object.hasOwn(value, 'N')) return Number(value.N);
  if (Object.hasOwn(value, 'BOOL')) return value.BOOL;
  if (Object.hasOwn(value, 'NULL')) return null;
  if (Object.hasOwn(value, 'L')) return value.L.map(dynamoValue);
  if (Object.hasOwn(value, 'M')) return dynamoImage(value.M);
  return undefined;
}

function dynamoImage(image) {
  if (!image) return null;
  return Object.fromEntries(Object.entries(image).map(([key, value]) => [key, dynamoValue(value)]));
}

async function processStreamRecord(record) {
  const eventName = record.eventName;
  const oldTask = dynamoImage(record.dynamodb?.OldImage);
  const newTask = dynamoImage(record.dynamodb?.NewImage);
  const task = eventName === 'REMOVE' ? oldTask : newTask;
  if (!task || task.entity_type !== 'TASK' || !task.user_id || !task.task_id) return;
  if (eventName === 'REMOVE') {
    await deleteTaskForUser(task.user_id, task.task_id);
  } else {
    await syncTaskForUser(task.user_id, task);
  }
}

async function processScheduledReconciliation() {
  const connections = await scanConnections();
  for (const connection of connections) {
    try {
      if (connection.status === 'disable_pending') {
        const result = await reconcileUserCalendar(connection.user_id, { removeAll: true, limit: 5 });
        if (result.complete) {
          await revokeRefreshTokenIfConfigured(connection.user_id);
          await finishDisable(connection.user_id);
        }
      } else if (connection.status === 'enabled') {
        await reconcileUserCalendar(connection.user_id, { limit: 5 });
      }
    } catch (err) {
      console.error('Scheduled Calendar reconciliation failed:', connection.user_id, err.code || 'calendar_sync_failed');
    }
  }
  return { processed: connections.length };
}

exports.handler = async (event) => {
  if (!Array.isArray(event?.Records)) {
    const result = await processScheduledReconciliation();
    return { statusCode: 200, body: JSON.stringify(result) };
  }

  const batchItemFailures = [];
  for (const record of event.Records) {
    try {
      await processStreamRecord(record);
    } catch (err) {
      const syncError = err instanceof CalendarSyncError ? err : null;
      const sequenceNumber = record.dynamodb?.SequenceNumber;
      if (!sequenceNumber) throw new Error('DynamoDB stream sequence number is missing');
      console.error('Task Calendar stream synchronization failed:', sequenceNumber, syncError?.code || 'calendar_sync_failed');
      if (!syncError || syncError.retryable) {
        batchItemFailures.push({ itemIdentifier: sequenceNumber });
      }
    }
  }
  return { batchItemFailures };
};

exports._private = { dynamoImage, dynamoValue, processStreamRecord, processScheduledReconciliation };
