import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, ExternalLink, RefreshCw, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { tasksApi } from '../services/api';
import { useAccount } from '../contexts/AccountContext';
import { exportTasksToIcs } from '../services/calendar';
import type { Task } from '../types/api';
import CalendarActions from './CalendarActions';

function Calendar() {
  const { calendar_sync: calendarSync } = useAccount();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await tasksApi.getAll();
      setTasks(response.data.data.tasks || []);
    } catch (loadError) {
      console.error('Error loading calendar tasks:', loadError);
      setError('Unable to load your calendar. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  const agenda = useMemo(() => tasks
    .filter((task) => task.status !== 'completed')
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()), [tasks]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Calendar</h1>
          <p className="mt-1 text-sm text-gray-500">Google Calendar is the default. You can also export deadlines to any calendar app.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={agenda.length === 0}
            onClick={() => exportTasksToIcs(agenda)}
          >
            <Download size={18} /> Export .ics
          </button>
          <a
            className="btn-primary flex items-center justify-center gap-2"
            href="https://calendar.google.com/calendar/u/0/r"
            target="_blank"
            rel="noreferrer"
          >
            <CalendarDays size={19} /> Open Google Calendar <ExternalLink size={15} />
          </a>
        </div>
      </div>

      <div className="app-surface flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Automatic Google Calendar updates</p>
          <p className="text-sm text-gray-500">
            {calendarSync.enabled
              ? 'On — task changes are synchronized automatically.'
              : calendarSync.linked
                ? 'Google is linked. Enable separate Calendar permission to synchronize automatically.'
                : 'Link Google in Account Settings to enable optional automatic synchronization.'}
          </p>
        </div>
        <Link className="btn-secondary flex shrink-0 items-center justify-center gap-2" to="/account/settings">
          <Settings size={17} /> {calendarSync.enabled ? 'Sync settings' : 'Set up sync'}
        </Link>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700" role="alert">
          <span>{error}</span>
          <button type="button" className="flex items-center gap-1 font-semibold" onClick={() => void loadTasks()}>
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="app-surface flex min-h-64 items-center justify-center rounded-3xl border">
          <div className="h-11 w-11 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : agenda.length === 0 ? (
        <div className="app-surface rounded-3xl border p-10 text-center sm:p-14">
          <CalendarDays className="mx-auto mb-4 text-gray-400" size={52} />
          <h2 className="text-xl font-semibold">Your agenda is clear</h2>
          <p className="mx-auto mt-2 max-w-md text-gray-500">Create a task with a deadline and it will appear here, ready to export to any calendar app.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agenda.map((task) => {
            const deadline = new Date(task.deadline);
            const overdue = deadline.getTime() < Date.now();
            return (
              <article key={task.task_id} className="app-surface flex gap-4 rounded-2xl border p-4 shadow-sm sm:p-5">
                <div className={overdue ? 'date-tile date-tile-overdue' : 'date-tile'}>
                  <span>{deadline.toLocaleDateString([], { month: 'short' })}</span>
                  <strong>{deadline.getDate()}</strong>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold sm:text-lg">{task.title}</h2>
                      <p className={overdue ? 'mt-1 text-sm font-medium text-red-600' : 'mt-1 text-sm text-gray-500'}>
                        {overdue ? 'Overdue · ' : ''}{deadline.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <CalendarActions task={task} />
                  </div>
                  {task.description && <p className="mt-2 line-clamp-2 text-sm text-gray-600">{task.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-primary-50 px-2.5 py-1 font-medium text-primary-700">{task.task_type.replace('_', ' ')}</span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600">{task.progress_percentage}% complete</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Calendar;
