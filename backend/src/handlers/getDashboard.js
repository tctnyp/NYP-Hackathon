const { queryItems } = require('../utils/database');
const { success, error, getUserId } = require('../utils/response');
const { withNormalizedPriority } = require('../utils/taskPriority');

/**
 * GET /dashboard
 * Get dashboard statistics and overview
 */
exports.handler = async (event) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return error('Unauthorized', 401);
    }

    // Get and normalize all tasks so legacy difficulty records expose priority.
    const storedTasks = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'TASK#',
      },
    });
    const allTasks = storedTasks.map(withNormalizedPriority);

    const now = new Date();
    
    // Calculate statistics
    const stats = {
      total_tasks: allTasks.length,
      completed_tasks: allTasks.filter(t => t.status === 'completed').length,
      in_progress_tasks: allTasks.filter(t => t.status === 'in_progress').length,
      not_started_tasks: allTasks.filter(t => t.status === 'not_started').length,
      overdue_tasks: allTasks.filter(t => t.status === 'overdue').length,
      actual_overdue: allTasks.filter(t => new Date(t.deadline) < now && t.status !== 'completed').length,
      due_today: allTasks.filter(t => {
        const hoursUntil = (new Date(t.deadline) - now) / (1000 * 60 * 60);
        return hoursUntil <= 24 && t.status !== 'completed';
      }).length,
      due_this_week: allTasks.filter(t => {
        const hoursUntil = (new Date(t.deadline) - now) / (1000 * 60 * 60);
        return hoursUntil > 24 && hoursUntil <= 168 && t.status !== 'completed';
      }).length,
      total_estimated_hours: allTasks.reduce((sum, t) => sum + (t.estimated_hours || 0), 0),
      avg_priority: allTasks.length > 0 
        ? allTasks.reduce((sum, t) => sum + (t.priority_score || 0), 0) / allTasks.length 
        : 0,
    };

    // Get upcoming deadlines (next 7 days)
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingTasks = allTasks
      .filter(t => {
        const deadline = new Date(t.deadline);
        return t.status !== 'completed' && deadline >= now && deadline <= sevenDaysFromNow;
      })
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 10)
      .map(t => ({
        ...t,
        days_until_deadline: (new Date(t.deadline) - now) / (1000 * 60 * 60 * 24),
      }));

    // Get modules
    const modules = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'MODULE#',
      },
    });

    // Calculate tasks by module
    const tasksByModule = modules.map(module => {
      const moduleTasks = allTasks.filter(t => t.module_id === module.module_id);
      return {
        module_code: module.module_code,
        module_name: module.module_name,
        color: module.color,
        total_tasks: moduleTasks.length,
        completed_tasks: moduleTasks.filter(t => t.status === 'completed').length,
        active_tasks: moduleTasks.filter(t => t.status !== 'completed').length,
      };
    }).sort((a, b) => b.active_tasks - a.active_tasks);

    // Get workload by week (next 4 weeks)
    const fourWeeksFromNow = new Date(now.getTime() + 4 * 7 * 24 * 60 * 60 * 1000);
    const weekMap = new Map();
    
    allTasks
      .filter(t => {
        const deadline = new Date(t.deadline);
        return t.status !== 'completed' && deadline >= now && deadline <= fourWeeksFromNow;
      })
      .forEach(t => {
        const deadline = new Date(t.deadline);
        const weekStart = new Date(deadline);
        weekStart.setDate(deadline.getDate() - deadline.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weekMap.has(weekKey)) {
          weekMap.set(weekKey, { week_start: weekKey, task_count: 0, total_hours: 0, high_priority_count: 0 });
        }
        
        const week = weekMap.get(weekKey);
        week.task_count++;
        week.total_hours += t.estimated_hours || 0;
        if (t.priority_score > 30) week.high_priority_count++;
      });

    const workloadByWeek = Array.from(weekMap.values()).sort((a, b) => 
      new Date(a.week_start) - new Date(b.week_start)
    );

    // Get recent completed tasks
    const recentlyCompleted = allTasks
      .filter(t => t.status === 'completed' && t.completed_at)
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
      .slice(0, 5);

    // Get high priority tasks
    const highPriorityTasks = allTasks
      .filter(t => t.status !== 'completed' && (t.priority_score || 0) > 20)
      .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
      .slice(0, 5);

    // Calculate completion rate
    const completionRate = stats.total_tasks > 0
      ? Math.round((stats.completed_tasks / stats.total_tasks) * 100)
      : 0;

    return success({
      statistics: {
        ...stats,
        completion_rate: completionRate,
      },
      upcoming_tasks: upcomingTasks,
      tasks_by_module: tasksByModule,
      workload_by_week: workloadByWeek,
      recently_completed: recentlyCompleted,
      high_priority_tasks: highPriorityTasks,
    });
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
    return error('Failed to fetch dashboard data', 500, err.message);
  }
};
