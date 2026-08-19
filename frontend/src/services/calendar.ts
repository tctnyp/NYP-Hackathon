import type { Task } from '../types/api';

interface CalendarWindow {
  start: Date;
  end: Date;
}

function calendarWindow(task: Task): CalendarWindow {
  const end = new Date(task.deadline);
  const durationHours = Math.min(Math.max(Number(task.estimated_hours || 1), 0.5), 12);
  return { start: new Date(end.getTime() - durationHours * 3_600_000), end };
}

function compactUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function taskDescription(task: Task) {
  const details = [
    task.description?.trim(),
    `Type: ${task.task_type.replace('_', ' ')}`,
    `Priority: ${task.priority.replace('_', ' ')}`,
    `Progress: ${task.progress_percentage}%`,
  ];
  return details.filter(Boolean).join('\n');
}

function taskEvent(task: Task) {
  const { start, end } = calendarWindow(task);
  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcs(task.task_id)}@munera`,
    `DTSTAMP:${compactUtc(new Date())}`,
    `DTSTART:${compactUtc(start)}`,
    `DTEND:${compactUtc(end)}`,
    `SUMMARY:${escapeIcs(task.title)}`,
    `DESCRIPTION:${escapeIcs(taskDescription(task))}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(`Upcoming: ${task.title}`)}`,
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

function calendarFile(tasks: Task[]) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Munera//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...tasks.map(taskEvent),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function safeFileName(value: string) {
  const name = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return name || 'academic-task';
}

function downloadCalendar(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportTaskToDeviceCalendar(task: Task) {
  const content = calendarFile([task]);
  const fileName = `${safeFileName(task.title)}.ics`;
  const file = new File([content], fileName, { type: 'text/calendar' });
  const shareData = { title: task.title, text: 'Add this academic task to your calendar.', files: [file] };

  if (navigator.share && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }

  downloadCalendar(content, fileName);
}

export function exportTasksToIcs(tasks: Task[]) {
  downloadCalendar(calendarFile(tasks), 'munera-tasks.ics');
}

export function googleCalendarUrl(task: Task) {
  const { start, end } = calendarWindow(task);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: `${compactUtc(start)}/${compactUtc(end)}`,
    details: taskDescription(task),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(task: Task) {
  const { start, end } = calendarWindow(task);
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: task.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: taskDescription(task),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
