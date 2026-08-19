import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  MailWarning,
  RefreshCw,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { groupsApi, tasksApi } from '../services/api';
import type { GroupTask, GroupTaskStatus, GroupSummary, Task, TaskStatus } from '../types/api';
import { NOTIFICATIONS_INVALIDATED_EVENT } from '../utils/notifications';

type GroupSummaryNotification = Pick<GroupSummary, 'group_id' | 'name'>;
type InvitationNotification = {
  group_id: string;
  group_name: string;
  invited_by_name: string;
};
type PersonalTaskNotification = Pick<Task, 'task_id' | 'title' | 'deadline' | 'status'>;
type ValidatedGroupTask = Pick<GroupTask, 'task_id' | 'group_id' | 'title' | 'deadline' | 'status' | 'assigned_to'>;
type GroupTaskNotification = Omit<ValidatedGroupTask, 'assigned_to'> & { group_name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDeadline(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(new Date(value).getTime());
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'not_started' || value === 'in_progress' || value === 'completed' || value === 'overdue';
}

function isGroupTaskStatus(value: unknown): value is GroupTaskStatus {
  return value === 'not_started' || value === 'in_progress' || value === 'completed';
}

function isGroupSummaryNotification(value: unknown): value is GroupSummaryNotification {
  return isRecord(value) && isNonEmptyString(value.group_id) && isNonEmptyString(value.name);
}

function isInvitationNotification(value: unknown): value is InvitationNotification {
  return isRecord(value)
    && isNonEmptyString(value.group_id)
    && isNonEmptyString(value.group_name)
    && isNonEmptyString(value.invited_by_name);
}

function isPersonalTaskNotification(value: unknown): value is PersonalTaskNotification {
  return isRecord(value)
    && isNonEmptyString(value.task_id)
    && isNonEmptyString(value.title)
    && isValidDeadline(value.deadline)
    && isTaskStatus(value.status);
}

function isValidatedGroupTask(value: unknown): value is ValidatedGroupTask {
  return isRecord(value)
    && isNonEmptyString(value.task_id)
    && isNonEmptyString(value.group_id)
    && isNonEmptyString(value.title)
    && isValidDeadline(value.deadline)
    && isGroupTaskStatus(value.status)
    && (value.assigned_to === null || isNonEmptyString(value.assigned_to));
}

function normalizeArray<T>(
  value: unknown,
  isValid: (item: unknown) => item is T,
): { items: T[]; malformed: boolean } {
  if (!Array.isArray(value)) return { items: [], malformed: true };
  const items = value.filter(isValid);
  return { items, malformed: items.length !== value.length };
}

function getResponsePayload(response: unknown): Record<string, unknown> | null {
  if (!isRecord(response) || !isRecord(response.data) || !isRecord(response.data.data)) return null;
  return response.data.data;
}

function NotificationCenter() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [invitations, setInvitations] = useState<InvitationNotification[]>([]);
  const [tasks, setTasks] = useState<PersonalTaskNotification[]>([]);
  const [groupTasks, setGroupTasks] = useState<GroupTaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const centerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastLoadedAtRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const initialRouteRef = useRef(true);

  const loadNotifications = useCallback(async (refresh = false) => {
    const request = ++requestSequenceRef.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const [groupsResult, tasksResult] = await Promise.allSettled([
        groupsApi.getAll(),
        tasksApi.getAll(),
      ]);
      if (request !== requestSequenceRef.current) return;

      const failures = new Set<string>();
      if (tasksResult.status === 'fulfilled') {
        const taskPayload = getResponsePayload(tasksResult.value);
        const normalizedTasks = normalizeArray(taskPayload?.tasks, isPersonalTaskNotification);
        setTasks(normalizedTasks.items);
        if (normalizedTasks.malformed) failures.add('personal tasks');
      } else {
        setTasks([]);
        failures.add('personal tasks');
      }

      if (groupsResult.status === 'fulfilled') {
        const groupPayload = getResponsePayload(groupsResult.value);
        const normalizedGroups = normalizeArray(groupPayload?.groups, isGroupSummaryNotification);
        const joinedGroups = normalizedGroups.items.slice(0, 30);
        if (normalizedGroups.malformed) failures.add('some group tasks');

        const normalizedInvitations = normalizeArray(groupPayload?.invitations, isInvitationNotification);
        setInvitations(normalizedInvitations.items);
        if (normalizedInvitations.malformed) failures.add('group invitations');

        const detailResults = await Promise.allSettled(
          joinedGroups.map((group) => groupsApi.getById(group.group_id)),
        );
        if (request !== requestSequenceRef.current) return;

        const nextGroupTasks: GroupTaskNotification[] = [];
        let hasDetailFailures = false;
        detailResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            hasDetailFailures = true;
            return;
          }

          const detailPayload = getResponsePayload(result.value);
          const detail = isRecord(detailPayload?.group) ? detailPayload.group : null;
          if (!detail
            || detail.group_id !== joinedGroups[index].group_id
            || !isNonEmptyString(detail.name)
            || !Array.isArray(detail.tasks)) {
            hasDetailFailures = true;
            return;
          }

          const groupName = detail.name;
          const normalizedGroupTasks = normalizeArray(detail.tasks, isValidatedGroupTask);
          if (normalizedGroupTasks.malformed) hasDetailFailures = true;
          normalizedGroupTasks.items.forEach((task) => {
            if (task.group_id !== joinedGroups[index].group_id) {
              hasDetailFailures = true;
              return;
            }
            if (task.assigned_to === user?.sub) {
              nextGroupTasks.push({
                task_id: task.task_id,
                group_id: task.group_id,
                title: task.title,
                deadline: task.deadline,
                status: task.status,
                group_name: groupName,
              });
            }
          });
        });
        setGroupTasks(nextGroupTasks);
        if (hasDetailFailures) failures.add('some group tasks');
      } else {
        setInvitations([]);
        setGroupTasks([]);
        failures.add('group invitations and tasks');
      }

      if (failures.size) setError(`Could not refresh ${Array.from(failures).join(' and ')}.`);
    } catch {
      if (request === requestSequenceRef.current) setError('Could not refresh notifications.');
    } finally {
      if (request === requestSequenceRef.current) {
        lastLoadedAtRef.current = Date.now();
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user?.sub]);

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    const invalidate = () => void loadNotifications(true);
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidate);
    return () => window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidate);
  }, [loadNotifications]);

  useEffect(() => {
    if (initialRouteRef.current) {
      initialRouteRef.current = false;
      return;
    }
    if (Date.now() - lastLoadedAtRef.current >= 5_000) void loadNotifications(true);
  }, [location.pathname, location.search, loadNotifications]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (Date.now() - lastLoadedAtRef.current >= 60_000) void loadNotifications(true);
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [loadNotifications]);

  const closePopover = useCallback((restoreFocus = false) => {
    const focusWasInside = Boolean(centerRef.current?.contains(document.activeElement));
    setOpen(false);
    if (restoreFocus || focusWasInside) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    if (Date.now() - lastLoadedAtRef.current >= 15_000) void loadNotifications(true);
    headingRef.current?.focus();
    const close = (event: MouseEvent) => {
      if (!centerRef.current?.contains(event.target as Node)) closePopover();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePopover(true);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [closePopover, loadNotifications, open]);

  const overdueTasks = useMemo(() => tasks
    .filter((task) => task.status !== 'completed' && Number.isFinite(new Date(task.deadline).getTime()) && new Date(task.deadline).getTime() < Date.now())
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()), [tasks]);
  const overdueGroupTasks = useMemo(() => groupTasks
    .filter((task) => task.status !== 'completed' && Number.isFinite(new Date(task.deadline).getTime()) && new Date(task.deadline).getTime() < Date.now())
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()), [groupTasks]);
  const needsEmailVerification = user?.email_verified === false;
  const totalCount = invitations.length + overdueTasks.length + overdueGroupTasks.length + (needsEmailVerification ? 1 : 0);
  const hasItems = totalCount > 0;
  const triggerLabel = totalCount
    ? `Notifications, ${totalCount} pending${needsEmailVerification ? ', including email verification' : ''}`
    : 'Notifications';

  return (
    <div className="notification-center" ref={centerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="notification-trigger"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls="notification-popover"
        onClick={() => open ? closePopover(true) : setOpen(true)}
      >
        <Bell size={20} />
        {totalCount > 0 && <span className="notification-badge" aria-live="polite">{totalCount > 99 ? '99+' : totalCount}</span>}
      </button>

      {open && (
        <section id="notification-popover" className="notification-popover" role="dialog" aria-modal="false" aria-labelledby="notification-heading">
          <header className="notification-header">
            <div>
              <h2 id="notification-heading" ref={headingRef} tabIndex={-1}>Notifications</h2>
              <p>{totalCount ? `${totalCount} item${totalCount === 1 ? '' : 's'} need attention` : 'Your notification center'}</p>
            </div>
            <div className="notification-header-actions">
              <button type="button" disabled={refreshing} onClick={() => void loadNotifications(true)} aria-label="Refresh notifications" title="Refresh">
                {refreshing ? <LoaderCircle className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              </button>
              <button type="button" onClick={() => closePopover(true)} aria-label="Close notifications"><X size={19} /></button>
            </div>
          </header>

          <div className="notification-body" aria-live="polite" aria-busy={loading}>
            {loading ? (
              <div className="notification-state"><LoaderCircle className="animate-spin" size={23} /><p>Loading notifications…</p></div>
            ) : (
              <>
                {error && <div className="notification-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => void loadNotifications(true)}>Try again</button></div>}

                {needsEmailVerification && (
                  <Link to="/account/settings#email-verification" className="notification-item notification-verification" onClick={() => closePopover(true)}>
                    <span className="notification-item-icon"><MailWarning size={19} /></span>
                    <span><strong>Verify your email address</strong><small>Request and enter a verification code in account settings.</small></span>
                  </Link>
                )}

                {invitations.map((invitation) => (
                  <Link key={`invite-${invitation.group_id}`} to="/groups" className="notification-item" onClick={() => closePopover(true)}>
                    <span className="notification-item-icon notification-icon-blue"><UsersRound size={19} /></span>
                    <span><strong>Group invitation: {invitation.group_name}</strong><small>{invitation.invited_by_name} invited you. Review and respond in Groups.</small></span>
                  </Link>
                ))}

                {overdueTasks.map((task) => (
                  <Link key={`task-${task.task_id}`} to="/tasks" className="notification-item" onClick={() => closePopover(true)}>
                    <span className="notification-item-icon notification-icon-red"><CalendarClock size={19} /></span>
                    <span><strong>Overdue: {task.title}</strong><small>Due {new Date(task.deadline).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Open Tasks to update it.</small></span>
                  </Link>
                ))}

                {overdueGroupTasks.map((task) => (
                  <Link key={`group-task-${task.group_id}-${task.task_id}`} to={`/groups?group=${encodeURIComponent(task.group_id)}`} className="notification-item" onClick={() => closePopover(true)}>
                    <span className="notification-item-icon notification-icon-red"><CalendarClock size={19} /></span>
                    <span><strong>Overdue in {task.group_name}: {task.title}</strong><small>Due {new Date(task.deadline).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Open this group to update it.</small></span>
                  </Link>
                ))}

                {!hasItems && !error && (
                  <div className="notification-state notification-empty"><CheckCircle2 size={26} /><strong>You’re all caught up</strong><p>No invitations or overdue tasks.</p></div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default NotificationCenter;
