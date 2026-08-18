import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../services/api';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, ListTodo, Plus, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import type { DashboardData, DashboardModuleSummary, DashboardStatistics, DashboardWorkloadWeek, Task } from '../types/api';
import { useAccount } from '../contexts/AccountContext';
import NotificationPrompt from './NotificationPrompt';

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
                  <span>{module.active_tasks} active ┬╖ {module.completed_tasks} done</span>
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

function friendlyDeadline(task: Task) {
  const deadline = new Date(task.deadline);
  const diffDays = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  return deadline.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { profile } = useAccount();

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await dashboardApi.get();
      setData(response.data.data);
    } catch (loadError) {
      console.error(loadError);
      setError('We couldn’t load your overview. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="page-shell" aria-label="Loading dashboard">
        <div className="skeleton h-28 rounded-3xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="skeleton h-32 rounded-2xl" />)}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]"><div className="skeleton h-80 rounded-3xl" /><div className="skeleton h-80 rounded-3xl" /></div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page-shell">
        <header className="page-header"><div><p className="eyebrow"><Sparkles size={14} /> Your day at a glance</p><h1 className="page-title">Overview unavailable</h1><p className="page-subtitle">Your data is safe. We just couldn’t reach it right now.</p></div></header>
        <div className="section-card empty-state min-h-80"><div className="empty-icon"><RefreshCw size={25} /></div><h2>Let’s try that again</h2><p>Check your connection, then reload your overview.</p><button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => void loadDashboard()}><RefreshCw size={16} /> Retry</button></div>
      </div>
    );
  }

  const stats = { ...emptyStats, ...(data?.statistics || {}) };

  const upcoming = data?.upcoming_tasks?.slice(0, 4) || [];
  const priorities = data?.high_priority_tasks?.slice(0, 3) || [];
  const firstName = (profile.display_name || profile.full_name || '').trim().split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const statCards = [
    { name: 'Total tasks', value: stats.total_tasks, note: 'Across your workspace', icon: ListTodo, tone: 'metric-blue' },
    { name: 'In progress', value: stats.in_progress_tasks, note: 'Keep the momentum', icon: Clock3, tone: 'metric-amber' },
    { name: 'Overdue', value: stats.overdue_tasks, note: stats.overdue_tasks ? 'Needs attention' : 'You’re all caught up', icon: AlertCircle, tone: 'metric-red' },
    { name: 'Completion', value: `${stats.completion_rate}%`, note: `${stats.completed_tasks} tasks completed`, icon: TrendingUp, tone: 'metric-green' },
  ];

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Your day at a glance</p>
          <h1 className="page-title">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="page-subtitle">Focus on what matters now. We’ll keep the rest organized.</p>
        </div>
        <Link to="/tasks?create=1" className="btn-primary inline-flex items-center justify-center gap-2"><Plus size={18} /> New task</Link>
      </header>

      <NotificationPrompt />

      {error && (
        <div className="alert-error" role="alert">
          <span className="flex items-center gap-2"><AlertCircle size={18} /> {error}</span>
          <button type="button" onClick={() => void loadDashboard()} className="inline-flex items-center gap-1.5 font-semibold"><RefreshCw size={15} /> Retry</button>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Task statistics">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <article key={stat.name} className="metric-card">
              <div className={`metric-icon ${stat.tone}`}><Icon size={20} /></div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{stat.value}</p>
                <p className="mt-1 truncate text-xs text-gray-400">{stat.note}</p>
              </div>
            </article>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,1fr)]">
        <section className="section-card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
            <div>
              <h2 className="section-title">Coming up</h2>
              <p className="mt-0.5 text-sm text-gray-500">Your nearest deadlines</p>
            </div>
            <Link to="/tasks" className="text-link">View all <ArrowRight size={15} /></Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="empty-state min-h-64">
              <div className="empty-icon"><CheckCircle2 size={25} /></div>
              <h3>You’re all clear</h3>
              <p>No upcoming tasks. Enjoy the breathing room or plan what’s next.</p>
              <Link to="/tasks" className="btn-secondary mt-2 inline-flex items-center gap-2"><Plus size={16} /> Add a task</Link>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--app-border)' }}>
              {upcoming.map((task) => {
                const overdue = new Date(task.deadline).getTime() < Date.now();
                return (
                  <Link key={task.task_id} to="/tasks" className="group flex items-center gap-4 px-5 py-4 transition hover:bg-blue-50/50 sm:px-6">
                    <span className={`status-dot ${overdue ? 'bg-red-500' : task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'}`} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold group-hover:text-primary-700">{task.title}</h3>
                      <p className="mt-1 text-xs capitalize text-gray-500">{task.task_type.replace('_', ' ')} · {task.progress_percentage}% complete</p>
                    </div>
                    <span className={`shrink-0 text-sm font-medium ${overdue ? 'text-red-600' : 'text-gray-500'}`}>{friendlyDeadline(task)}</span>
                    <ArrowRight size={17} className="hidden text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600 sm:block" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="section-card">
            <div className="flex items-center gap-5">
              <div className="progress-ring" style={{ '--progress': `${Math.min(100, Math.max(0, stats.completion_rate)) * 3.6}deg` } as React.CSSProperties}>
                <div><strong>{stats.completion_rate}%</strong><span>done</span></div>
              </div>
              <div>
                <p className="eyebrow mb-1">This term</p>
                <h2 className="section-title">Steady progress</h2>
                <p className="mt-1 text-sm leading-5 text-gray-500">{stats.completed_tasks} of {stats.total_tasks} tasks completed.</p>
              </div>
            </div>
          </section>

          <section className="section-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title">Priority focus</h2>
              <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">Top {priorities.length}</span>
            </div>
            {priorities.length === 0 ? (
              <p className="rounded-2xl bg-green-50 p-4 text-sm font-medium text-green-700">Nothing urgent right now. Nice work.</p>
            ) : (
              <ol className="space-y-3">
                {priorities.map((task, index) => (
                  <li key={task.task_id} className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-xs font-bold text-orange-700">{index + 1}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{task.title}</p><p className="mt-0.5 text-xs text-gray-500">{friendlyDeadline(task)}</p></div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
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
