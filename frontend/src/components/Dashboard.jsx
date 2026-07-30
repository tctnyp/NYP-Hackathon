import { useEffect, useState } from 'react';
import { dashboardApi } from '../services/api';
import { 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  TrendingUp,
  Calendar,
  Book,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await dashboardApi.get();
      setData(response.data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error loading dashboard: {error}</p>
      </div>
    );
  }

  const stats = data?.statistics || {};
  const upcomingTasks = data?.upcoming_tasks || [];
  const highPriorityTasks = data?.high_priority_tasks || [];
  const tasksByModule = data?.tasks_by_module || [];

  const statCards = [
    {
      name: 'Total Tasks',
      value: stats.total_tasks || 0,
      icon: CheckCircle,
      color: 'blue',
    },
    {
      name: 'In Progress',
      value: stats.in_progress_tasks || 0,
      icon: Clock,
      color: 'yellow',
    },
    {
      name: 'Overdue',
      value: stats.overdue_tasks || 0,
      icon: AlertCircle,
      color: 'red',
    },
    {
      name: 'Completion Rate',
      value: `${stats.completion_rate || 0}%`,
      icon: TrendingUp,
      color: 'green',
    },
  ];

  const getUrgencyColor = (daysUntil) => {
    if (daysUntil < 0) return 'text-red-600 bg-red-50';
    if (daysUntil <= 1) return 'text-red-600 bg-red-50';
    if (daysUntil <= 3) return 'text-orange-600 bg-orange-50';
    if (daysUntil <= 7) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Welcome back! Here's your academic overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          const colorClasses = {
            blue: 'bg-blue-500',
            yellow: 'bg-yellow-500',
            red: 'bg-red-500',
            green: 'bg-green-500',
          };

          return (
            <div key={stat.name} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stat.value}</p>
                </div>
                <div className={`${colorClasses[stat.color]} w-12 h-12 rounded-lg flex items-center justify-center`}>
                  <Icon className="text-white" size={24} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Deadlines */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Calendar className="text-primary-600" size={20} />
              <h2 className="text-lg font-semibold text-gray-900">Upcoming Deadlines</h2>
            </div>
          </div>
          <div className="p-6">
            {upcomingTasks.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No upcoming deadlines</p>
            ) : (
              <div className="space-y-4">
                {upcomingTasks.map((task) => (
                  <div
                    key={task.task_id}
                    className="flex items-start justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{task.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {task.module_code && (
                          <span
                            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                            style={{ backgroundColor: task.module_color + '20', color: task.module_color }}
                          >
                            {task.module_code}
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {format(new Date(task.deadline), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    </div>
                    <div className={`ml-4 px-3 py-1 rounded-full text-xs font-medium ${getUrgencyColor(task.days_until_deadline)}`}>
                      {task.days_until_deadline < 0
                        ? 'Overdue'
                        : task.days_until_deadline < 1
                        ? 'Today'
                        : `${Math.ceil(task.days_until_deadline)}d`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* High Priority Tasks */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="text-red-600" size={20} />
              <h2 className="text-lg font-semibold text-gray-900">High Priority</h2>
            </div>
          </div>
          <div className="p-6">
            {highPriorityTasks.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No high priority tasks</p>
            ) : (
              <div className="space-y-4">
                {highPriorityTasks.map((task) => (
                  <div
                    key={task.task_id}
                    className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900">{task.title}</h3>
                        <div className="mt-2 flex items-center gap-2">
                          {task.module_code && (
                            <span
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                              style={{ backgroundColor: task.module_color + '20', color: task.module_color }}
                            >
                              {task.module_code}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">{task.task_type}</span>
                        </div>
                      </div>
                      <div className="ml-4 text-right">
                        <div className="text-lg font-bold text-red-600">
                          {Math.round(task.priority_score)}
                        </div>
                        <div className="text-xs text-gray-500">priority</div>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary-600 h-2 rounded-full transition-all"
                          style={{ width: `${task.progress_percentage}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{task.progress_percentage}% complete</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tasks by Module */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Book className="text-primary-600" size={20} />
            <h2 className="text-lg font-semibold text-gray-900">Tasks by Module</h2>
          </div>
        </div>
        <div className="p-6">
          {tasksByModule.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No modules yet</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tasksByModule.map((module) => (
                <div
                  key={module.module_code}
                  className="p-4 border-2 rounded-lg hover:shadow-md transition-shadow"
                  style={{ borderColor: module.color }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{module.module_code}</h3>
                      <p className="text-sm text-gray-600 truncate">{module.module_name}</p>
                    </div>
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                      style={{ backgroundColor: module.color }}
                    >
                      {module.active_tasks}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Total: {module.total_tasks}</span>
                    <span className="text-green-600">✓ {module.completed_tasks}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
