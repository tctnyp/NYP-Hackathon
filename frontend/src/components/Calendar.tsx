import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Download, ExternalLink, RefreshCw, Settings } from 'lucide-react';
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
      setError('We couldn’t load your calendar. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTasks(); }, []);

  const agenda = useMemo(() => tasks
    .filter((task) => task.status !== 'completed')
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()), [tasks]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div><p className="eyebrow"><CalendarDays size={14} /> Schedule</p><h1 className="page-title">Calendar</h1><p className="page-subtitle">Google Calendar is the default. You can also export deadlines to any calendar app.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={agenda.length === 0} onClick={() => exportTasksToIcs(agenda)}><Download size={18} /> Export .ics</button>
          <a className="btn-primary inline-flex items-center justify-center gap-2" href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer"><CalendarDays size={19} /> Open Google Calendar <ExternalLink size={15} /></a>
        </div>
      </header>

      <section className="section-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="calendar-sync-summary">
        <div>
          <h2 id="calendar-sync-summary" className="section-title">Automatic Google Calendar updates</h2>
          <p className="mt-1 text-sm text-gray-500">
            {calendarSync.enabled
              ? 'On — task changes are synchronized automatically.'
              : calendarSync.linked
                ? 'Google is linked. Enable separate Calendar permission to synchronize automatically.'
                : 'Link Google in Account Settings to enable optional automatic synchronization.'}
          </p>
        </div>
        <Link className="btn-secondary inline-flex shrink-0 items-center justify-center gap-2" to="/account/settings"><Settings size={17} /> {calendarSync.enabled ? 'Sync settings' : 'Set up sync'}</Link>
      </section>

      {error && <div className="alert-error" role="alert"><span className="flex items-center gap-2"><AlertCircle size={18} /> {error}</span><button type="button" className="inline-flex items-center gap-1.5 font-semibold" onClick={() => void loadTasks()}><RefreshCw size={15} /> Retry</button></div>}

      {loading ? (
        <div className="space-y-3" aria-label="Loading calendar">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-28 rounded-2xl" />)}</div>
      ) : error && agenda.length === 0 ? (
        <div className="section-card empty-state min-h-80"><div className="empty-icon"><RefreshCw size={25} /></div><h2>Calendar unavailable</h2><p>Your deadlines are still safe. Try again once your connection is ready.</p><button type="button" className="btn-secondary" onClick={() => void loadTasks()}>Try again</button></div>
      ) : agenda.length === 0 ? (
        <div className="section-card empty-state min-h-96"><div className="empty-icon"><CalendarDays size={26} /></div><h2>Your agenda is clear</h2><p>Tasks with deadlines will appear here, ready to export to Apple Calendar, Google Calendar, or Outlook.</p></div>
      ) : (
        <section className="section-card overflow-visible p-0" aria-label="Upcoming deadlines">
          <div className="border-b px-5 py-4 sm:px-6" style={{ borderColor: 'var(--app-border)' }}><h2 className="section-title">Upcoming deadlines</h2><p className="mt-1 text-sm text-gray-500">{agenda.length} {agenda.length === 1 ? 'task' : 'tasks'} on your agenda</p></div>
          <div className="divide-y" style={{ borderColor: 'var(--app-border)' }}>
            {agenda.map((task) => {
              const deadline = new Date(task.deadline);
              const overdue = deadline.getTime() < Date.now();
              return (
                <article key={task.task_id} className="flex gap-4 px-4 py-4 transition hover:bg-blue-50/40 sm:px-6 sm:py-5">
                  <div className={overdue ? 'date-tile date-tile-overdue' : 'date-tile'}><span>{deadline.toLocaleDateString([], { month: 'short' })}</span><strong>{deadline.getDate()}</strong></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h3 className="truncate font-semibold sm:text-[1.02rem]">{task.title}</h3><p className={overdue ? 'mt-1 text-sm font-medium text-red-600' : 'mt-1 text-sm text-gray-500'}>{overdue ? 'Overdue · ' : ''}{deadline.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p></div>
                      <CalendarActions task={task} />
                    </div>
                    {task.description && <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-500">{task.description}</p>}
                    <div className="mt-3 flex flex-wrap gap-2"><span className="status-pill status-blue">{task.task_type.replace('_', ' ')}</span><span className="status-pill status-neutral">{task.progress_percentage}% complete</span></div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default Calendar;
