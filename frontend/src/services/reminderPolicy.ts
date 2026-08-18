export type ReminderUrgency = 'overdue' | 'due_1h' | 'due_6h' | 'due_24h' | 'due_3d' | 'later';

export interface ReminderRecord {
  signature: string;
  notifiedAt: number;
  dayKey: string;
  dailyCount: number;
}

interface ReminderPolicyInput {
  now: Date;
  deadline: string;
  signature: string;
  previous: ReminderRecord | null;
  isAppHidden: boolean;
}

export interface ReminderDecision {
  allowed: boolean;
  reason: 'allowed' | 'visible' | 'quiet_hours' | 'outside_window' | 'daily_limit' | 'cooldown';
  urgency: ReminderUrgency;
  record: ReminderRecord;
}

export const QUIET_HOURS = { start: 22, end: 8 } as const;
export const MAX_REMINDERS_PER_DAY = 3;

const ROUTINE_WINDOWS = [
  { start: 8, end: 10.5 },
  { start: 13, end: 15.5 },
  { start: 18, end: 20.5 },
] as const;

function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localHour(date: Date) {
  return date.getHours() + date.getMinutes() / 60;
}

export function reminderUrgency(deadlineValue: string, now = new Date()): ReminderUrgency {
  const hours = (new Date(deadlineValue).getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) return 'overdue';
  if (hours <= 1) return 'due_1h';
  if (hours <= 6) return 'due_6h';
  if (hours <= 24) return 'due_24h';
  if (hours <= 72) return 'due_3d';
  return 'later';
}

export function evaluateReminderPolicy({ now, deadline, signature, previous, isAppHidden }: ReminderPolicyInput): ReminderDecision {
  const urgency = reminderUrgency(deadline, now);
  const today = localDayKey(now);
  const previousCount = previous?.dayKey === today ? Math.max(0, previous.dailyCount || 0) : 0;
  const record: ReminderRecord = {
    signature,
    notifiedAt: now.getTime(),
    dayKey: today,
    dailyCount: previousCount + 1,
  };

  if (!isAppHidden) return { allowed: false, reason: 'visible', urgency, record };

  const hour = localHour(now);
  const quiet = hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end;
  if (quiet) return { allowed: false, reason: 'quiet_hours', urgency, record };
  if (previousCount >= MAX_REMINDERS_PER_DAY) return { allowed: false, reason: 'daily_limit', urgency, record };

  const urgent = urgency === 'due_1h' || urgency === 'due_6h';
  const usefulWindow = ROUTINE_WINDOWS.some((window) => hour >= window.start && hour <= window.end);
  if (!urgent && !usefulWindow) return { allowed: false, reason: 'outside_window', urgency, record };

  if (previous) {
    const sameGuidance = previous.signature === signature;
    const cooldownMs = sameGuidance
      ? (urgent ? 2 * 60 * 60 * 1000 : urgency === 'overdue' ? 12 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000)
      : (urgent ? 45 * 60 * 1000 : 2 * 60 * 60 * 1000);
    if (now.getTime() - previous.notifiedAt < cooldownMs) {
      return { allowed: false, reason: 'cooldown', urgency, record };
    }
  }

  return { allowed: true, reason: 'allowed', urgency, record };
}
