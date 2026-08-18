const { getItem, updateItem, TASKS_TABLE, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody } = require('../utils/response');
const {
  PRIORITY_LEVELS,
  calculatePriorityScore,
  requestedPriority,
  taskPriority,
  withNormalizedPriority,
} = require('../utils/taskPriority');

/**
 * PUT /tasks/{taskId}
 * Update an existing task
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

    const body = parseBody(event);
    if (!body) {
      return error('Invalid JSON body', 400);
    }

    const existingTask = await getItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `TASK#${taskId}`,
    });

    if (!existingTask) {
      return error('Task not found', 404);
    }

    const updates = { updated_at: timestamp() };
    const allowedFields = [
      'module_id', 'title', 'description', 'task_type', 'deadline',
      'estimated_hours', 'grade_weight', 'priority', 'is_group_work',
      'status', 'progress_percentage',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.priority !== undefined || body.difficulty !== undefined) {
      const priority = requestedPriority(body);
      if (!priority) {
        return error(`Invalid priority. Must be one of: ${PRIORITY_LEVELS.join(', ')}`, 400);
      }
      updates.priority = priority;
    }

    if (Object.keys(updates).length === 1) {
      return error('No fields to update', 400);
    }

    if (body.status === 'completed' && existingTask.status !== 'completed') {
      updates.completed_at = timestamp();
      updates.progress_percentage = 100;
      updates.GSI3PK = `USER#${userId}#STATUS#completed`;
    }

    if (body.status && body.status !== 'completed' && existingTask.status === 'completed') {
      updates.completed_at = null;
      updates.GSI3PK = `USER#${userId}#STATUS#${body.status}`;
    }

    if (body.status && body.status !== existingTask.status
        && body.status !== 'completed' && existingTask.status !== 'completed') {
      updates.GSI3PK = `USER#${userId}#STATUS#${body.status}`;
    }

    const mergedTask = { ...existingTask, ...updates };
    updates.priority = taskPriority(mergedTask);
    const newPriorityScore = calculatePriorityScore(mergedTask);
    updates.priority_score = newPriorityScore;
    updates.GSI3SK = `PRIORITY#${Math.round(newPriorityScore)}#TASK#${taskId}`;

    if (body.deadline) {
      updates.GSI1SK = `DEADLINE#${body.deadline}#TASK#${taskId}`;
    }

    if (body.module_id !== undefined) {
      if (body.module_id) {
        updates.GSI2PK = `USER#${userId}#MODULE#${body.module_id}`;
        updates.GSI2SK = `TASK#${taskId}`;
      } else {
        updates.GSI2PK = null;
        updates.GSI2SK = null;
      }
    }

    const updatedTask = await updateItem(
      TASKS_TABLE,
      { PK: `USER#${userId}`, SK: `TASK#${taskId}` },
      updates,
    );

    return success({ task: withNormalizedPriority(updatedTask) });
  } catch (err) {
    console.error('Error updating task:', err);
    return error('Failed to update task', 500, err.message);
  }
};
