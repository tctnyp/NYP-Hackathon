const { getItem, updateItem, TASKS_TABLE, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody } = require('../utils/response');

/**
 * Calculate priority score
 */
function calculatePriorityScore(task) {
  const deadline = new Date(task.deadline);
  const now = new Date();
  const daysUntilDeadline = (deadline - now) / (1000 * 60 * 60 * 24);

  let urgencyScore = 0;
  if (daysUntilDeadline <= 0) {
    urgencyScore = 100;
  } else if (daysUntilDeadline <= 1) {
    urgencyScore = 50;
  } else if (daysUntilDeadline <= 3) {
    urgencyScore = 30;
  } else if (daysUntilDeadline <= 7) {
    urgencyScore = 15;
  } else {
    urgencyScore = 10 / daysUntilDeadline;
  }

  const importanceScore = (task.grade_weight || 10) / 2;
  const effortScore = (task.estimated_hours || 5) * 0.5;

  const difficultyMultiplier = {
    easy: 1,
    medium: 1.5,
    hard: 2,
    very_hard: 2.5,
  }[task.difficulty] || 1;

  return (urgencyScore * 0.5 + importanceScore * 0.3 + effortScore * 0.2) * difficultyMultiplier;
}

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

    // Get existing task
    const existingTask = await getItem(TASKS_TABLE, {
      PK: `USER#${userId}`,
      SK: `TASK#${taskId}`,
    });

    if (!existingTask) {
      return error('Task not found', 404);
    }

    // Build updates
    const updates = { updated_at: timestamp() };

    const allowedFields = [
      'module_id', 'title', 'description', 'task_type', 'deadline',
      'estimated_hours', 'grade_weight', 'difficulty', 'is_group_work',
      'status', 'progress_percentage',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 1) { // Only updated_at
      return error('No fields to update', 400);
    }

    // If marking as completed
    if (body.status === 'completed' && existingTask.status !== 'completed') {
      updates.completed_at = timestamp();
      updates.progress_percentage = 100;
      updates.GSI3PK = `USER#${userId}#STATUS#completed`;
    }

    // If changing from completed to another status
    if (body.status && body.status !== 'completed' && existingTask.status === 'completed') {
      updates.completed_at = null;
      updates.GSI3PK = `USER#${userId}#STATUS#${body.status}`;
    }

    // If status changed but not to/from completed
    if (body.status && body.status !== existingTask.status && 
        body.status !== 'completed' && existingTask.status !== 'completed') {
      updates.GSI3PK = `USER#${userId}#STATUS#${body.status}`;
    }

    // Recalculate priority if relevant fields changed
    const mergedTask = { ...existingTask, ...updates };
    const newPriority = calculatePriorityScore(mergedTask);
    updates.priority_score = newPriority;
    updates.GSI3SK = `PRIORITY#${Math.round(newPriority)}#TASK#${taskId}`;

    // Update GSI1SK if deadline changed
    if (body.deadline) {
      updates.GSI1SK = `DEADLINE#${body.deadline}#TASK#${taskId}`;
    }

    // Update GSI2 if module changed
    if (body.module_id !== undefined) {
      if (body.module_id) {
        updates.GSI2PK = `USER#${userId}#MODULE#${body.module_id}`;
        updates.GSI2SK = `TASK#${taskId}`;
      } else {
        updates.GSI2PK = null;
        updates.GSI2SK = null;
      }
    }

    // Update the task
    const updatedTask = await updateItem(
      TASKS_TABLE,
      { PK: `USER#${userId}`, SK: `TASK#${taskId}` },
      updates
    );

    return success({ task: updatedTask });
  } catch (err) {
    console.error('Error updating task:', err);
    return error('Failed to update task', 500, err.message);
  }
};
