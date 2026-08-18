const { queryItems } = require('../utils/database');
const { success, error, getUserId } = require('../utils/response');
const { withNormalizedPriority } = require('../utils/taskPriority');

/**
 * GET /tasks
 * Get all tasks for the authenticated user with filters
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    const queryParams = event.queryStringParameters || {};
    const {
      status,
      module_id,
      task_type,
      sort_by = 'deadline',
    } = queryParams;

    let tasks = [];

    if (status) {
      tasks = await queryItems({
        IndexName: 'GSI3-TasksByStatus',
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}#STATUS#${status}`,
        },
      });
    } else if (module_id) {
      tasks = await queryItems({
        IndexName: 'GSI2-TasksByModule',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}#MODULE#${module_id}`,
        },
      });
    } else if (sort_by === 'deadline') {
      tasks = await queryItems({
        IndexName: 'GSI1-TasksByDeadline',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
        },
      });
    } else {
      tasks = await queryItems({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'TASK#',
        },
      });
    }

    if (task_type) {
      tasks = tasks.filter((task) => task.task_type === task_type);
    }

    const now = new Date();
    const enrichedTasks = tasks.map((storedTask) => {
      const task = withNormalizedPriority(storedTask);
      const deadline = new Date(task.deadline);
      const hoursUntilDeadline = (deadline - now) / (1000 * 60 * 60);
      const daysUntilDeadline = hoursUntilDeadline / 24;

      let urgencyLevel = 'future';
      if (deadline < now && task.status !== 'completed') {
        urgencyLevel = 'overdue';
      } else if (hoursUntilDeadline <= 24) {
        urgencyLevel = 'critical';
      } else if (hoursUntilDeadline <= 72) {
        urgencyLevel = 'urgent';
      } else if (hoursUntilDeadline <= 168) {
        urgencyLevel = 'upcoming';
      }

      return {
        ...task,
        days_until_deadline: daysUntilDeadline,
        urgency_level: urgencyLevel,
      };
    });

    if (sort_by === 'priority_score') {
      enrichedTasks.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
    } else if (sort_by === 'title') {
      enrichedTasks.sort((a, b) => a.title.localeCompare(b.title));
    }

    return success({ tasks: enrichedTasks });
  } catch (err) {
    console.error('Error fetching tasks:', err);
    return error('Failed to fetch tasks', 500, err.message);
  }
};
