const { putItem, batchWrite, TASKS_TABLE, generateId, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody, validateRequired } = require('../utils/response');

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
      difficulty = 'medium',
      is_group_work = false,
    } = body;

    // Validate task_type
    const validTypes = ['assignment', 'test', 'exam', 'project', 'presentation', 'report', 'competition', 'other'];
    if (!validTypes.includes(task_type)) {
      return error(`Invalid task_type. Must be one of: ${validTypes.join(', ')}`, 400);
    }

    // Validate difficulty
    const validDifficulties = ['easy', 'medium', 'hard', 'very_hard'];
    if (!validDifficulties.includes(difficulty)) {
      return error(`Invalid difficulty. Must be one of: ${validDifficulties.join(', ')}`, 400);
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
      difficulty,
      is_group_work,
      status: 'not_started',
      progress_percentage: 0,
      priority_score: 0,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };

    // Calculate priority score
    task.priority_score = calculatePriorityScore(task);
    task.GSI3SK = `PRIORITY#${Math.round(task.priority_score)}#TASK#${taskId}`;

    // Add GSI2 if module_id exists
    if (module_id) {
      task.GSI2PK = `USER#${userId}#MODULE#${module_id}`;
      task.GSI2SK = `TASK#${taskId}`;
    }

    // Insert task
    await putItem(TASKS_TABLE, task);

    // Create default reminders
    const deadlineDate = new Date(deadline);
    const nowDate = new Date();
    const hoursUntilDeadline = (deadlineDate - nowDate) / (1000 * 60 * 60);

    const reminders = [];

    if (hoursUntilDeadline > 168) { // More than 7 days
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
