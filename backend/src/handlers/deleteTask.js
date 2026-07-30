const { getItem, deleteItem, queryItems, TASKS_TABLE } = require('../utils/database');
const { success, error, getUserId } = require('../utils/response');
const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/database');

/**
 * DELETE /tasks/{taskId}
 * Delete a task and all related items (subtasks, reminders)
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const taskId = event.pathParameters?.taskId;
    if (!taskId) {
      return error('Missing taskId parameter', 400);
    }

    // Verify task belongs to user
    const existingTask = await getItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `TASK#${taskId}`,
    });

    if (!existingTask) {
      return error('Task not found', 404);
    }

    // Delete the task
    await deleteItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `TASK#${taskId}`,
    });

    // Query and delete all subtasks
    const subtasks = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `TASK#${taskId}#SUBTASK#`,
      },
    });

    // Query and delete all reminders (using GSI4)
    const reminders = await queryItems({
      IndexName: 'GSI4-RemindersByTask',
      KeyConditionExpression: 'GSI4PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TASK#${taskId}`,
      },
    });

    // Batch delete subtasks and reminders
    const itemsToDelete = [
      ...subtasks.map(item => ({
        DeleteRequest: {
          Key: { PK: item.PK, SK: item.SK },
        },
      })),
      ...reminders.map(item => ({
        DeleteRequest: {
          Key: { PK: item.PK, SK: item.SK },
        },
      })),
    ];

    // DynamoDB batch write limit is 25 items
    if (itemsToDelete.length > 0) {
      const chunks = [];
      for (let i = 0; i < itemsToDelete.length; i += 25) {
        chunks.push(itemsToDelete.slice(i, i + 25));
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

    return success({ 
      message: 'Task deleted successfully',
      deleted_subtasks: subtasks.length,
      deleted_reminders: reminders.length,
    });
  } catch (err) {
    console.error('Error deleting task:', err);
    return error('Failed to delete task', 500, err.message);
  }
};
