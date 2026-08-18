import { CalendarPlus, Download, ExternalLink, Smartphone } from 'lucide-react';
import type { Task } from '../types/api';
import { exportTaskToDeviceCalendar, googleCalendarUrl, outlookCalendarUrl } from '../services/calendar';

interface CalendarActionsProps {
  task: Task;
  align?: 'left' | 'right';
}

function CalendarActions({ task, align = 'right' }: CalendarActionsProps) {
  return (
    <details className="calendar-menu relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-2 text-gray-500 transition hover:bg-primary-50 hover:text-primary-700"
        aria-label={`Add ${task.title} to a calendar`}
        title="Add to calendar"
      >
        <CalendarPlus size={18} />
      </summary>
      <div className={`app-surface absolute z-20 mt-2 w-60 rounded-2xl border p-2 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
        <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Add to calendar</p>
        <button
          type="button"
          onClick={() => void exportTaskToDeviceCalendar(task)}
          className="calendar-action"
        >
          <Smartphone size={18} />
          <span className="flex-1 text-left">Phone calendar / .ics</span>
          <Download size={15} />
        </button>
        <a className="calendar-action" href={googleCalendarUrl(task)} target="_blank" rel="noreferrer">
          <CalendarPlus size={18} />
          <span className="flex-1">Google Calendar</span>
          <ExternalLink size={15} />
        </a>
        <a className="calendar-action" href={outlookCalendarUrl(task)} target="_blank" rel="noreferrer">
          <CalendarPlus size={18} />
          <span className="flex-1">Microsoft Outlook</span>
          <ExternalLink size={15} />
        </a>
      </div>
    </details>
  );
}

export default CalendarActions;
