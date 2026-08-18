const { putItem, batchWrite, TASKS_TABLE, generateId, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody, validateRequired } = require('../utils/response');
const { PRIORITY_LEVELS, calculatePriorityScore, requestedPriority } = require('../utils/taskPriority');

/**
 * POST /tasks
 * Create a new task
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const body = parseBody(event);
    if (!body) {
      return error('Invalid JSON body', 400);
    }

    const required = validateRequired(body, ['title', 'task_type', 'deadline']);
    if (required) {
      return error(`Missing required fields: ${required.join(', ')}`, 400);
    }

    const {
      module_id,
      title,
      description,
      task_type,
      deadline,
      estimated_hours,
      grade_weight,
      is_group_work = false,
    } = body;
    const priority = requestedPriority(body);

    const validTypes = ['assignment', 'test', 'exam', 'project', 'presentation', 'report', 'competition', 'other'];
    if (!validTypes.includes(task_type)) {
      return error(`Invalid task_type. Must be one of: ${validTypes.join(', ')}`, 400);
    }

    if (!priority) {
      return error(`Invalid priority. Must be one of: ${PRIORITY_LEVELS.join(', ')}`, 400);
    }

    const taskId = generateId();
    const now = timestamp();

    const task = {
      PK: `USER#${userId}`,
      SK: `TASK#${taskId}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `DEADLINE#${deadline}#TASK#${taskId}`,
      GSI3PK: `USER#${userId}#STATUS#not_started`,
      GSI3SK: `PRIORITY#0#TASK#${taskId}`,
      entity_type: 'TASK',
      task_id: taskId,
      user_id: userId,
      module_id: module_id || null,
      title,
      description: description || null,
      task_type,
      deadline,
      estimated_hours: estimated_hours || null,
      grade_weight: grade_weight || null,
      priority,
      is_group_work,
      status: 'not_started',
      progress_percentage: 0,
      priority_score: 0,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };

    task.priority_score = calculatePriorityScore(task);
    task.GSI3SK = `PRIORITY#${Math.round(task.priority_score)}#TASK#${taskId}`;

    if (module_id) {
      task.GSI2PK = `USER#${userId}#MODULE#${module_id}`;
      task.GSI2SK = `TASK#${taskId}`;
    }

    await putItem(TASKS_TABLE, task);

    const deadlineDate = new Date(deadline);
    const nowDate = new Date();
    const hoursUntilDeadline = (deadlineDate - nowDate) / (1000 * 60 * 60);
    const reminders = [];

    if (hoursUntilDeadline > 168) {
      const reminderTime = new Date(deadlineDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      reminders.push({
        PutRequest: {
          Item: {
            PK: `REMINDER#${reminderTime.toISOString().split('T')[0]}#${reminderTime.getHours()}`,
            SK: `TASK#${taskId}#${generateId()}`,
            GSI4PK: `TASK#${taskId}`,
            GSI4SK: `REMINDER#${generateId()}`,
            entity_type: 'REMINDER',
            reminder_id: generateId(),
            task_id: taskId,
            user_id: userId,
            reminder_time: reminderTime.toISOString(),
            reminder_type: 'both',
            message: `${title} is due in 7 days`,
            is_sent: false,
            created_at: now,
          },
        },
      });
    }

    if (hoursUntilDeadline > 72) {
      const reminderTime = new Date(deadlineDate.getTime() - 3 * 24 * 60 * 60 * 1000);
      reminders.push({
        PutRequest: {
          Item: {
            PK: `REMINDER#${reminderTime.toISOString().split('T')[0]}#${reminderTime.getHours()}`,
            SK: `TASK#${taskId}#${generateId()}`,
            GSI4PK: `TASK#${taskId}`,
            GSI4SK: `REMINDER#${generateId()}`,
            entity_type: 'REMINDER',
            reminder_id: generateId(),
            task_id: taskId,
            user_id: userId,
            reminder_time: reminderTime.toISOString(),
            reminder_type: 'both',
            message: `${title} is due in 3 days`,
            is_sent: false,
            created_at: now,
          },
        },
      });
    }

    if (hoursUntilDeadline > 24) {
      const reminderTime = new Date(deadlineDate.getTime() - 24 * 60 * 60 * 1000);
      reminders.push({
        PutRequest: {
          Item: {
            PK: `REMINDER#${reminderTime.toISOString().split('T')[0]}#${reminderTime.getHours()}`,
            SK: `TASK#${taskId}#${generateId()}`,
            GSI4PK: `TASK#${taskId}`,
            GSI4SK: `REMINDER#${generateId()}`,
            entity_type: 'REMINDER',
            reminder_id: generateId(),
            task_id: taskId,
            user_id: userId,
            reminder_time: reminderTime.toISOString(),
            reminder_type: 'both',
            message: `${title} is due tomorrow!`,
            is_sent: false,
            created_at: now,
          },
        },
      });
    }

    if (reminders.length > 0) {
      await batchWrite(reminders);
    }

    return success({ task, reminders_created: reminders.length }, 201);
  } catch (err) {
    console.error('Error creating task:', err);
    return error('Failed to create task', 500, err.message);
  }
};
