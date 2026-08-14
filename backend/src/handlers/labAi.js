const { getItem, queryItems, batchWrite, TASKS_TABLE, generateId, timestamp } = require('../utils/database');
const { success, error, getUserId, parseBody } = require('../utils/response');

function activeTasksFor(userId) {
  return queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'TASK#',
    },
  }).then((items) => items.filter((item) => item.entity_type === 'TASK' && item.status !== 'completed'));
}

function priorityValue(task) {
  const deadline = new Date(task.deadline).getTime();
  const hoursLeft = (deadline - Date.now()) / 3_600_000;
  const urgency = hoursLeft <= 0 ? 100 : hoursLeft <= 24 ? 70 : hoursLeft <= 72 ? 45 : hoursLeft <= 168 ? 25 : 5;
  const weight = Number(task.grade_weight || 0);
  const unfinished = 100 - Number(task.progress_percentage || 0);
  return Number(task.priority_score || 0) + urgency + weight * 0.4 + unfinished * 0.1;
}

exports.prioritize = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);

    const tasks = await activeTasksFor(userId);
    const ranked = [...tasks].sort((a, b) => priorityValue(b) - priorityValue(a));
    const now = Date.now();
    const topPriorities = ranked.slice(0, 3).map((task) => {
      const hoursLeft = Math.round((new Date(task.deadline).getTime() - now) / 3_600_000);
      const timing = hoursLeft < 0 ? 'overdue' : hoursLeft < 24 ? `due in ${Math.max(hoursLeft, 0)} hours` : `due in ${Math.ceil(hoursLeft / 24)} days`;
      return {
        task_id: task.task_id,
        reason: `${task.title} is ${timing} and is ${task.progress_percentage || 0}% complete.`,
        suggested_action: `Spend ${Math.min(Number(task.estimated_hours || 2), 3)} focused hour(s) on ${task.title}.`,
      };
    });

    const overdue = ranked.filter((task) => new Date(task.deadline).getTime() < now);
    const dueSoon = ranked.filter((task) => {
      const remaining = new Date(task.deadline).getTime() - now;
      return remaining >= 0 && remaining <= 48 * 3_600_000;
    });
    const warnings = [];
    if (overdue.length) warnings.push(`${overdue.length} task(s) are overdue.`);
    if (dueSoon.length > 1) warnings.push(`${dueSoon.length} task(s) are due within 48 hours.`);

    return success({
      recommendations: {
        top_priorities: topPriorities,
        warnings,
        daily_plan: {
          today: topPriorities[0]?.suggested_action || 'No active tasks. Take time to plan upcoming work.',
          tomorrow: topPriorities[1]?.suggested_action || 'Review upcoming deadlines.',
          day_after: topPriorities[2]?.suggested_action || 'Prepare for the next assignment.',
        },
        workload_assessment: tasks.length === 0
          ? 'No active tasks.'
          : tasks.length >= 6
            ? 'High workload: reduce scope and schedule focused sessions.'
            : 'Workload is manageable with consistent daily progress.',
      },
      task_count: tasks.length,
      mode: 'deterministic-lab',
    });
  } catch (err) {
    console.error('Lab prioritization failed:', err);
    return error('Failed to generate prioritization', 500, err.message);
  }
};

exports.breakdown = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const taskId = event.pathParameters?.taskId;
    if (!taskId) return error('Missing taskId parameter', 400);

    const task = await getItem(TASKS_TABLE, { PK: `USER#${userId}`, SK: `TASK#${taskId}` });
    if (!task) return error('Task not found', 404);

    const existing = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': `TASK#${taskId}#SUBTASK#`,
      },
    });
    if (existing.length) {
      return success({ breakdown: { subtasks: existing, tips: ['Complete one step at a time.'] }, subtasks_created: 0, cached: true, mode: 'deterministic-lab' });
    }

    const estimatedHours = Math.max(Number(task.estimated_hours || 5), 1);
    const steps = [
      ['Clarify requirements', `Review the requirements and define the expected outcome for ${task.title}.`],
      ['Gather resources', 'Collect notes, references, data, and tools needed for the work.'],
      ['Create first draft', `Produce the first complete version of the ${task.task_type || 'task'}.`],
      ['Review and improve', 'Check accuracy, structure, formatting, and assessment criteria.'],
      ['Finalize and submit', 'Run a final check, export the required format, and submit before the deadline.'],
    ];
    const createdAt = timestamp();
    const subtasks = steps.map(([title, description], index) => ({
      subtask_id: generateId(),
      task_id: taskId,
      user_id: userId,
      title,
      description,
      estimated_minutes: Math.max(Math.round((estimatedHours * 60) / steps.length), 15),
      order: index + 1,
      is_completed: false,
      created_at: createdAt,
    }));

    await batchWrite(subtasks.map((subtask) => ({
      PutRequest: {
        Item: {
          ...subtask,
          PK: `USER#${userId}`,
          SK: `TASK#${taskId}#SUBTASK#${subtask.subtask_id}`,
          entity_type: 'SUBTASK',
          order_index: subtask.order,
        },
      },
    })));

    return success({
      breakdown: {
        subtasks,
        tips: ['Start early and time-box each step.', 'Ask for feedback before final submission.'],
        estimated_total_hours: estimatedHours,
      },
      subtasks_created: subtasks.length,
      cached: false,
      mode: 'deterministic-lab',
    });
  } catch (err) {
    console.error('Lab breakdown failed:', err);
    return error('Failed to generate task breakdown', 500, err.message);
  }
};

exports.agent = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) return error('Unauthorized', 401);
    const body = parseBody(event);
    if (!body?.query) return error('Missing query parameter', 400);

    const tasks = await activeTasksFor(userId);
    const ranked = [...tasks].sort((a, b) => priorityValue(b) - priorityValue(a));
    const query = String(body.query).toLowerCase();
    let response;

    if (!tasks.length) {
      response = 'You have no active tasks. Add a task with a deadline to receive planning guidance.';
    } else if (query.includes('overdue')) {
      const overdue = tasks.filter((task) => new Date(task.deadline) < new Date());
      response = overdue.length ? `You have ${overdue.length} overdue task(s): ${overdue.map((task) => task.title).join(', ')}.` : 'You have no overdue tasks.';
    } else {
      const next = ranked[0];
      response = `Focus on “${next.title}” next. It is due ${new Date(next.deadline).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} and is ${next.progress_percentage || 0}% complete.`;
    }

    return success({ query: body.query, response, context_tasks: tasks.length, mode: 'deterministic-lab' });
  } catch (err) {
    console.error('Lab agent failed:', err);
    return error('Failed to answer task query', 500, err.message);
  }
};
