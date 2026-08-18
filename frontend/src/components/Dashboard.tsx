import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { dashboardApi } from '../services/api';
import type { DashboardData, DashboardModuleSummary, DashboardStatistics, DashboardWorkloadWeek } from '../types/api';

const statusColors = {
  completed: '#16a34a',
  inProgress: '#2563eb',
  overdue: '#dc2626',
  notStarted: '#d97706',
};

const emptyStats: DashboardStatistics = {
  total_tasks: 0,
  completed_tasks: 0,
  in_progress_tasks: 0,
  not_started_tasks: 0,
  overdue_tasks: 0,
  actual_overdue: 0,
  due_today: 0,
  due_this_week: 0,
  total_estimated_hours: 0,
  avg_priority: 0,
  completion_rate: 0,
};

function safeColor(value: string | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2563eb';
}

function shortWeekLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function EmptyGraph({ message }: { message: string }) {
  return <p className="chart-empty">{message}</p>;
}

function TaskStatusGraph({ stats }: { stats: DashboardStatistics }) {
  const slices = [
    { label: 'Completed', value: stats.completed_tasks, color: statusColors.completed },
    { label: 'In progress', value: stats.in_progress_tasks, color: statusColors.inProgress },
    { label: 'Overdue', value: stats.overdue_tasks, color: statusColors.overdue },
    { label: 'Not started', value: stats.not_started_tasks, color: statusColors.notStarted },
  ];
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let cursor = 0;
  const stops = slices.map((slice) => {
    const start = cursor;
    cursor += total ? (slice.value / total) * 100 : 0;
    return `${slice.color} ${start}% ${cursor}%`;
  });
  const summary = slices.map((slice) => `${slice.label}: ${slice.value}`).join(', ');

  return (
    <section className="card chart-card" aria-labelledby="status-chart-heading">
      <div>
        <h2 id="status-chart-heading" className="text-lg font-semibold">Task status</h2>
        <p className="text-sm text-gray-600">Current distribution across all tasks.</p>
      </div>
      {total === 0 ? <EmptyGraph message="Create tasks to see their status distribution." /> : (
        <div className="status-chart-layout">
          <div
            className="status-donut"
            role="img"
            aria-label={`Task status chart. ${summary}`}
            style={{ background: `conic-gradient(${stops.join(', ')})` }}
          >
            <div className="status-donut-center" aria-hidden="true">
              <strong>{Math.round(stats.completion_rate)}%</strong>
              <span>complete</span>
            </div>
          </div>
          <ul className="chart-legend" aria-label="Task status values">
            {slices.map((slice) => (
              <li key={slice.label}>
                <span className="chart-swatch" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                <span>{slice.label}</span>
                <strong>{slice.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WeeklyWorkloadGraph({ weeks }: { weeks: DashboardWorkloadWeek[] }) {
  const maximum = Math.max(1, ...weeks.map((week) => Math.max(week.total_hours, week.task_count)));

  return (
    <section className="card chart-card" aria-labelledby="weekly-chart-heading">
      <div>
        <h2 id="weekly-chart-heading" className="text-lg font-semibold">Upcoming workload</h2>
        <p className="text-sm text-gray-600">Estimated hours due over the next four weeks.</p>
      </div>
      {weeks.length === 0 ? <EmptyGraph message="No active deadlines are scheduled in the next four weeks." /> : (
        <div className="weekly-chart" role="img" aria-label={`Weekly workload chart with ${weeks.length} weeks`}>
          {weeks.map((week) => {
            const metric = Math.max(week.total_hours, week.task_count);
            const height = Math.max(10, (metric / maximum) * 100);
            return (
              <div className="weekly-column" key={week.week_start}>
                <div className="weekly-value">
                  <strong>{week.total_hours.toFixed(1)}h</strong>
                  <span>{week.task_count} {week.task_count === 1 ? 'task' : 'tasks'}</span>
                </div>
                <div className="weekly-track" aria-hidden="true">
                  <div className="weekly-bar" style={{ height: `${height}%` }} />
                </div>
                <span className="weekly-label">{shortWeekLabel(week.week_start)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ModuleWorkloadGraph({ modules }: { modules: DashboardModuleSummary[] }) {
  const visibleModules = modules.filter((module) => module.total_tasks > 0).slice(0, 6);
  const maximum = Math.max(1, ...visibleModules.map((module) => module.total_tasks));

  return (
    <section className="card chart-card" aria-labelledby="module-chart-heading">
      <div>
        <h2 id="module-chart-heading" className="text-lg font-semibold">Tasks by module</h2>
        <p className="text-sm text-gray-600">Active and completed work in your busiest modules.</p>
      </div>
      {visibleModules.length === 0 ? <EmptyGraph message="Add tasks to modules to compare their workload." /> : (
        <ul className="module-chart" aria-label="Tasks by module">
          {visibleModules.map((module) => {
            const activeWidth = (module.active_tasks / maximum) * 100;
            const completedWidth = (module.completed_tasks / maximum) * 100;
            const color = safeColor(module.color);
            return (
              <li key={module.module_code}>
                <div className="module-chart-label">
                  <span className="truncate" title={module.module_name}>{module.module_code}</span>
                  <span>{module.active_tasks} active · {module.completed_tasks} done</span>
                </div>
                <div className="module-track" aria-hidden="true">
                  <span className="module-active" style={{ width: `${activeWidth}%`, backgroundColor: color }} />
                  <span className="module-completed" style={{ width: `${completedWidth}%`, backgroundColor: color }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await dashboardApi.get();
        setData(response.data.data);
      } catch (error) {
        console.error(error);
        setLoadError('Dashboard data could not be loaded. Try refreshing the page.');
      } finally {
        setLoading(false);
      }
    };
    void loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading dashboard">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-b-primary-600" />
      </div>
    );
  }

  const stats = { ...emptyStats, ...(data?.statistics || {}) };
  const statCards = [
    { name: 'Total tasks', value: stats.total_tasks, icon: CheckCircle, color: 'bg-blue-600' },
    { name: 'In progress', value: stats.in_progress_tasks, icon: Clock, color: 'bg-amber-600' },
    { name: 'Overdue', value: stats.actual_overdue || stats.overdue_tasks, icon: AlertCircle, color: 'bg-red-600' },
    { name: 'Completion', value: `${Math.round(stats.completion_rate)}%`, icon: TrendingUp, color: 'bg-green-600' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-1 text-gray-600">A visual summary of task progress and upcoming workload.</p>
      </div>

      {loadError && <p className="card text-sm font-medium text-red-600" role="alert">{loadError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <article key={stat.name} className="card dashboard-stat-card">
              <div>
                <p className="text-sm font-semibold text-gray-600">{stat.name}</p>
                <p className="mt-2 text-3xl font-bold">{stat.value}</p>
              </div>
              <div className={`${stat.color} flex h-12 w-12 items-center justify-center rounded-xl`} aria-hidden="true">
                <Icon className="text-white" size={24} />
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <TaskStatusGraph stats={stats} />
        <WeeklyWorkloadGraph weeks={data?.workload_by_week || []} />
      </div>
      <ModuleWorkloadGraph modules={data?.tasks_by_module || []} />
    </div>
  );
}

export default Dashboard;
