import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePwa } from '../contexts/PwaContext';
import { tasksApi } from '../services/api';
import { evaluateReminderPolicy, reminderUrgency, type ReminderRecord } from '../services/reminderPolicy';
import type { Task } from '../types/api';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;

const checkGuards = new Map<string, { inFlight: boolean; checkedAt: number }>();
const memoryRecords = new Map<string, ReminderRecord>();

function taskRank(task: Task) {
  const deadline = new Date(task.deadline).getTime();
  const hoursUntilDeadline = (deadline - Date.now()) / 3_600_000;
  const overdueBoost = hoursUntilDeadline < 0 ? 140 : 0;
  const dueSoonBoost = hoursUntilDeadline >= 0 && hoursUntilDeadline <= 24 ? 70 : hoursUntilDeadline <= 72 ? 35 : 0;
  const progressBoost = task.status === 'in_progress' ? 55 : 0;
  return (task.priority_score || 0) + overdueBoost + dueSoonBoost + progressBoost;
}

function deadlineText(task: Task) {
  const deadline = new Date(task.deadline);
  const difference = deadline.getTime() - Date.now();
  if (difference < 0) return 'Overdue — take one small step now.';
  const hours = Math.ceil(difference / 3_600_000);
  if (hours <= 1) return 'Due within the hour.';
  if (hours <= 6) return `Due in about ${hours} hours.`;
  if (hours <= 24) return 'Due today.';
  if (hours <= 48) return 'Due tomorrow.';
  return `Due ${deadline.toLocaleDateString([], { month: 'short', day: 'numeric' })}.`;
}

function TaskNotificationManager() {
  const { user } = useAuth();
  const { isInstalled, isOnline, notificationsEnabled, showNotification } = usePwa();

  useEffect(() => {
    if (!user || !isInstalled || !isOnline || !notificationsEnabled) return;
    const storageKey = `academic-task-guidance:${user.sub}`;
    let cancelled = false;

    const checkTasks = async () => {
      if (document.visibilityState !== 'hidden') return;
      const now = Date.now();
      const guard = checkGuards.get(storageKey) || { inFlight: false, checkedAt: 0 };
      if (guard.inFlight || now - guard.checkedAt < MIN_CHECK_GAP_MS) return;
      guard.inFlight = true;
      guard.checkedAt = now;
      checkGuards.set(storageKey, guard);

      try {
        const response = await tasksApi.getAll();
        if (cancelled || document.visibilityState !== 'hidden') return;
        const activeTasks = (response.data.data.tasks || [])
          .filter((task) => task.status !== 'completed')
          .sort((a, b) => taskRank(b) - taskRank(a) || new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
        const current = activeTasks[0];
        if (!current) return;
        const next = activeTasks[1];
        const urgency = reminderUrgency(current.deadline);
        const signature = [
          current.task_id, current.title, current.status, current.deadline, current.priority_score,
          current.progress_percentage, current.updated_at, urgency, next?.task_id, next?.title, next?.updated_at,
        ].join(':');
        const timestamp = Date.now();
        let previous = memoryRecords.get(storageKey) || null;
        try {
          const stored = JSON.parse(window.localStorage.getItem(storageKey) || 'null') as ReminderRecord | null;
          if (stored && Number.isFinite(stored.notifiedAt) && stored.notifiedAt <= timestamp) previous = stored;
        } catch { /* Use the in-memory fallback. */ }

        const decision = evaluateReminderPolicy({
          now: new Date(timestamp),
          deadline: current.deadline,
          signature,
          previous,
          isAppHidden: true,
        });
        if (!decision.allowed) return;

        const nextStep = next ? ` Next: ${next.title}.` : ' This is your final active task.';
        const shown = await showNotification({
          title: `Focus now: ${current.title}`,
          body: `${deadlineText(current)}${nextStep}`.slice(0, 220),
          tag: 'academic-task-guidance',
          url: '/tasks',
        });
        if (shown) {
          memoryRecords.set(storageKey, decision.record);
          try { window.localStorage.setItem(storageKey, JSON.stringify(decision.record)); } catch { /* In-memory limits remain active. */ }
        }
      } catch (error) {
        console.error('Unable to prepare task guidance notification:', error);
      } finally {
        const latestGuard = checkGuards.get(storageKey);
        if (latestGuard) latestGuard.inFlight = false;
      }
    };

    const interval = window.setInterval(() => void checkTasks(), CHECK_INTERVAL_MS);
    const checkWhenBackgrounded = () => {
      if (document.visibilityState === 'hidden') void checkTasks();
    };
    document.addEventListener('visibilitychange', checkWhenBackgrounded);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkWhenBackgrounded);
    };
  }, [isInstalled, isOnline, notificationsEnabled, showNotification, user]);

  return null;
}

export default TaskNotificationManager;
