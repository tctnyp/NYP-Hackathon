import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Crown,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { groupsApi } from '../services/api';
import type { CollaborativeGroup, GroupInvitation, GroupMember, GroupRole, GroupSummary, GroupTask, GroupVisibility, PublicGroupSummary } from '../types/api';
import { invalidateNotifications } from '../utils/notifications';

const groupColors = [
  { value: '#2563eb', label: 'Blue' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#db2777', label: 'Pink' },
  { value: '#dc2626', label: 'Red' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#16a34a', label: 'Green' },
  { value: '#0891b2', label: 'Teal' },
  { value: '#475569', label: 'Slate' },
];

function errorMessage(error: unknown) {
  const apiError = error as { response?: { data?: { error?: string } } };
  return apiError.response?.data?.error || 'Something went wrong. Please try again.';
}

function toDateTimeLocal(date = new Date(Date.now() + 24 * 60 * 60 * 1000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function Groups() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedGroupId = searchParams.get('group') || '';
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [publicGroups, setPublicGroups] = useState<PublicGroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [group, setGroup] = useState<CollaborativeGroup | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [taskActionError, setTaskActionError] = useState('');
  const [invitationError, setInvitationError] = useState('');
  const [publicGroupError, setPublicGroupError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [taskError, setTaskError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [activeView, setActiveView] = useState<'tasks' | 'people'>('tasks');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  const [groupForm, setGroupForm] = useState<{ name: string; description: string; color: string; visibility: GroupVisibility }>({ name: '', description: '', color: groupColors[0].value, visibility: 'private' });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', deadline: toDateTimeLocal(), assignedTo: '' });
  const detailSequence = useRef(0);
  const selectedIdRef = useRef('');
  const taskTabRef = useRef<HTMLButtonElement>(null);
  const peopleTabRef = useRef<HTMLButtonElement>(null);
  selectedIdRef.current = selectedId;
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dialogBusyRef = useRef(false);
  dialogBusyRef.current = busyAction === 'create-group' || busyAction === 'create-task';

  const loadGroups = async (preferredId?: string) => {
    try {
      setListLoading(true);
      setListError('');
      const response = await groupsApi.getAll();
      const nextGroups = response.data.data.groups || [];
      setGroups(nextGroups);
      setInvitations(response.data.data.invitations || []);
      setPublicGroups(response.data.data.public_groups || []);
      setSelectedId((current) => {
        const candidate = preferredId || current;
        return nextGroups.some((item) => item.group_id === candidate) ? candidate : nextGroups[0]?.group_id || '';
      });
      return true;
    } catch (loadError) {
      console.error('Error loading groups:', loadError);
      setListError(errorMessage(loadError));
      return false;
    } finally {
      setListLoading(false);
    }
  };

  const loadGroup = async (groupId: string) => {
    const request = ++detailSequence.current;
    try {
      setDetailLoading(true);
      setDetailError('');
      const response = await groupsApi.getById(groupId);
      if (request === detailSequence.current) setGroup(response.data.data.group);
    } catch (loadError) {
      if (request !== detailSequence.current) return;
      console.error('Error loading group:', loadError);
      setDetailError(errorMessage(loadError));
      setGroup(null);
    } finally {
      if (request === detailSequence.current) setDetailLoading(false);
    }
  };

  useEffect(() => { void loadGroups(requestedGroupId || undefined); }, []);
  useEffect(() => {
    if (requestedGroupId && groups.some((item) => item.group_id === requestedGroupId)) {
      setSelectedId(requestedGroupId);
    }
  }, [groups, requestedGroupId]);
  useEffect(() => {
    setActiveView('tasks');
    setTaskActionError('');
    setMemberError('');
    setMemberSuccess('');
    if (selectedId) void loadGroup(selectedId);
    else {
      detailSequence.current += 1;
      setDetailLoading(false);
      setDetailError('');
      setGroup(null);
    }
  }, [selectedId]);

  const modalOpen = createOpen || taskOpen;
  useEffect(() => {
    if (!modalOpen) return;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    window.setTimeout(() => {
      const preferred = dialog?.querySelector<HTMLElement>('[data-autofocus]');
      (preferred || dialog?.querySelector<HTMLElement>(focusableSelector))?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialogBusyRef.current) {
        event.preventDefault();
        setCreateOpen(false);
        setTaskOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [modalOpen]);

  const openCreate = () => {
    restoreFocusRef.current = document.activeElement as HTMLElement;
    setCreateError('');
    setCreateOpen(true);
  };
  const openTask = () => {
    restoreFocusRef.current = document.activeElement as HTMLElement;
    setTaskError('');
    setTaskOpen(true);
  };

  const memberNames = useMemo(() => new Map(group?.members.map((member) => [member.user_id, member.display_name]) || []), [group?.members]);
  const currentMember = group?.members.find((member) => member.user_id === user?.sub);
  const isGroupAdmin = currentMember?.role === 'admin';
  const isCreator = group?.owner_id === user?.sub;
  const openTaskCount = group?.tasks.filter((task) => task.status !== 'completed').length || 0;
  const anyActionBusy = Boolean(busyAction);

  const activateTab = (view: 'tasks' | 'people', focus = false) => {
    setActiveView(view);
    if (focus) {
      window.requestAnimationFrame(() => {
        (view === 'tasks' ? taskTabRef.current : peopleTabRef.current)?.focus();
      });
    }
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextView: 'tasks' | 'people' | null = null;
    if (event.key === 'Home') nextView = 'tasks';
    else if (event.key === 'End') nextView = 'people';
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextView = activeView === 'tasks' ? 'people' : 'tasks';
    }
    if (!nextView) return;
    event.preventDefault();
    activateTab(nextView, true);
  };

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusyAction('create-group');
      setCreateError('');
      const response = await groupsApi.create(groupForm);
      const created = response.data.data.group;
      setGroups((current) => [{ ...created, joined_at: created.created_at }, ...current]);
      setSelectedId(created.group_id);
      setGroup(created);
      setCreateOpen(false);
      setGroupForm({ name: '', description: '', color: groupColors[0].value, visibility: 'private' });
    } catch (createGroupError) {
      setCreateError(errorMessage(createGroupError));
    } finally {
      setBusyAction('');
    }
  };

  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!group) return;
    const groupId = group.group_id;
    try {
      setBusyAction('send-invitation');
      setMemberError('');
      setMemberSuccess('');
      await groupsApi.sendInvitation(groupId, memberEmail.trim());
      if (selectedIdRef.current !== groupId) return;
      setMemberEmail('');
      setMemberSuccess('If this address can be invited, the invitation was saved. Email delivery was attempted but is not guaranteed. They join only after accepting.');
    } catch (inviteError) {
      if (selectedIdRef.current === groupId) setMemberError(errorMessage(inviteError));
    } finally {
      setBusyAction('');
    }
  };

  const respondToInvitation = async (invitation: GroupInvitation, accept: boolean) => {
    const action = `${accept ? 'accept' : 'decline'}-${invitation.group_id}`;
    try {
      setBusyAction(action);
      setInvitationError('');
      if (accept) {
        await groupsApi.acceptInvitation(invitation.group_id);
        invalidateNotifications();
        setInvitations((current) => current.filter((item) => item.group_id !== invitation.group_id));
        await loadGroups(invitation.group_id);
      } else {
        await groupsApi.declineInvitation(invitation.group_id);
        invalidateNotifications();
        setInvitations((current) => current.filter((item) => item.group_id !== invitation.group_id));
      }
    } catch (respondError) {
      setInvitationError(errorMessage(respondError));
    } finally {
      setBusyAction('');
    }
  };

  const joinPublicGroup = async (publicGroup: PublicGroupSummary) => {
    try {
      setBusyAction(`join-${publicGroup.group_id}`);
      setPublicGroupError('');
      await groupsApi.join(publicGroup.group_id);
      invalidateNotifications();
      await loadGroups(publicGroup.group_id);
    } catch (joinError) {
      setPublicGroupError(errorMessage(joinError));
    } finally {
      setBusyAction('');
    }
  };

  const updateVisibility = async (visibility: GroupVisibility) => {
    if (!group || !isGroupAdmin || group.visibility === visibility) return;
    const groupId = group.group_id;
    try {
      setBusyAction('update-visibility');
      setMemberError('');
      await groupsApi.update(groupId, { visibility });
      setGroup((current) => current?.group_id === groupId ? { ...current, visibility } : current);
      setGroups((current) => current.map((item) => item.group_id === groupId ? { ...item, visibility } : item));
      await loadGroups(groupId);
    } catch (visibilityError) {
      if (selectedIdRef.current === groupId) setMemberError(errorMessage(visibilityError));
    } finally {
      setBusyAction('');
    }
  };

  const updateMemberRole = async (member: GroupMember, role: GroupRole) => {
    if (!group || !isGroupAdmin || member.user_id === group.owner_id || member.role === role) return;
    const groupId = group.group_id;
    try {
      setBusyAction(`role-${member.user_id}`);
      setMemberError('');
      setMemberSuccess('');
      await groupsApi.updateMemberRole(groupId, member.user_id, role);
      const updatedMember = { ...member, role };
      setGroup((current) => current?.group_id === groupId ? {
        ...current,
        members: current.members.map((item) => item.user_id === member.user_id ? updatedMember : item),
      } : current);
      setMemberSuccess(`${member.display_name} is now ${role === 'admin' ? 'an Admin' : 'a Member'}.`);
    } catch (roleError) {
      if (selectedIdRef.current === groupId) setMemberError(errorMessage(roleError));
    } finally {
      setBusyAction('');
    }
  };

  const clearPendingInvitations = async () => {
    if (!group || !window.confirm('Cancel every invitation that has not been accepted? Current group members will stay.')) return;
    const groupId = group.group_id;
    try {
      setBusyAction('clear-invitations');
      setMemberError('');
      setMemberSuccess('');
      await groupsApi.clearInvitations(groupId);
      if (selectedIdRef.current === groupId) setMemberSuccess('All unaccepted invitations were cancelled.');
    } catch (clearError) {
      if (selectedIdRef.current === groupId) setMemberError(errorMessage(clearError));
    } finally {
      setBusyAction('');
    }
  };

  const removeMember = async (member: GroupMember) => {
    if (!group) return;
    const groupId = group.group_id;
    const leaving = member.user_id === user?.sub;
    if (!window.confirm(leaving ? `Leave “${group.name}”?` : `Remove ${member.display_name} from this group? Their assigned tasks will become unassigned.`)) return;
    try {
      setBusyAction(`remove-${member.user_id}`);
      setMemberError('');
      setMemberSuccess('');
      await groupsApi.removeMember(groupId, member.user_id);
      invalidateNotifications();
      if (leaving) {
        const remaining = groups.filter((item) => item.group_id !== groupId);
        setGroups(remaining);
        setSelectedId(remaining[0]?.group_id || '');
      } else {
        setGroup((current) => current?.group_id === groupId ? {
          ...current,
          members: current.members.filter((item) => item.user_id !== member.user_id),
          tasks: current.tasks.map((task) => task.assigned_to === member.user_id ? { ...task, assigned_to: null } : task),
        } : current);
      }
    } catch (removeError) {
      if (selectedIdRef.current === groupId) setMemberError(errorMessage(removeError));
    } finally {
      setBusyAction('');
    }
  };

  const deleteGroup = async () => {
    if (!group || !window.confirm(`Permanently delete “${group.name}” and all of its tasks? This cannot be undone.`)) return;
    const groupId = group.group_id;
    try {
      setBusyAction('delete-group');
      setMemberError('');
      await groupsApi.delete(groupId);
      invalidateNotifications();
      const remaining = groups.filter((item) => item.group_id !== groupId);
      setGroups(remaining);
      setSelectedId(remaining[0]?.group_id || '');
    } catch (deleteError) {
      if (selectedIdRef.current === groupId) setMemberError(errorMessage(deleteError));
    } finally {
      setBusyAction('');
    }
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!group) return;
    const groupId = group.group_id;
    try {
      setBusyAction('create-task');
      setTaskError('');
      const response = await groupsApi.createTask(groupId, {
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        deadline: new Date(taskForm.deadline).toISOString(),
        assigned_to: taskForm.assignedTo || null,
      });
      const task = response.data.data.task;
      invalidateNotifications();
      setGroup((current) => current?.group_id === groupId ? {
        ...current,
        tasks: [...current.tasks, task].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()),
      } : current);
      setTaskOpen(false);
      setTaskForm({ title: '', description: '', deadline: toDateTimeLocal(), assignedTo: '' });
    } catch (createTaskError) {
      setTaskError(errorMessage(createTaskError));
    } finally {
      setBusyAction('');
    }
  };

  const toggleTask = async (task: GroupTask) => {
    if (!group) return;
    const groupId = group.group_id;
    try {
      setBusyAction(`toggle-${task.task_id}`);
      setTaskActionError('');
      const status = task.status === 'completed' ? 'not_started' : 'completed';
      const response = await groupsApi.updateTask(groupId, task.task_id, { status });
      invalidateNotifications();
      setGroup((current) => current?.group_id === groupId ? {
        ...current,
        tasks: current.tasks.map((item) => item.task_id === task.task_id ? response.data.data.task : item),
      } : current);
    } catch (updateError) {
      if (selectedIdRef.current === groupId) setTaskActionError(`“${task.title}” was not updated. ${errorMessage(updateError)}`);
    } finally {
      setBusyAction('');
    }
  };


  const assignTask = async (task: GroupTask, assignedTo: string) => {
    if (!group) return;
    const groupId = group.group_id;
    try {
      setBusyAction(`assign-${task.task_id}`);
      setTaskActionError('');
      const response = await groupsApi.updateTask(groupId, task.task_id, { assigned_to: assignedTo || null });
      invalidateNotifications();
      setGroup((current) => current?.group_id === groupId ? {
        ...current,
        tasks: current.tasks.map((item) => item.task_id === task.task_id ? response.data.data.task : item),
      } : current);
    } catch (assignError) {
      if (selectedIdRef.current === groupId) setTaskActionError(`“${task.title}” was not assigned. ${errorMessage(assignError)}`);
    } finally {
      setBusyAction('');
    }
  };

  const deleteTask = async (task: GroupTask) => {
    if (!group || !window.confirm(`Delete “${task.title}”?`)) return;
    const groupId = group.group_id;
    try {
      setBusyAction(`delete-task-${task.task_id}`);
      setTaskActionError('');
      await groupsApi.deleteTask(groupId, task.task_id);
      invalidateNotifications();
      setGroup((current) => current?.group_id === groupId ? {
        ...current,
        tasks: current.tasks.filter((item) => item.task_id !== task.task_id),
      } : current);
    } catch (deleteError) {
      if (selectedIdRef.current === groupId) setTaskActionError(`“${task.title}” was not deleted. ${errorMessage(deleteError)}`);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="page-shell groups-page">
      <header className="page-header groups-page-header">
        <div>
          <h1 className="page-title">Groups</h1>
          <p className="page-subtitle">Create private or public groups, collaborate with classmates, and track who is doing what.</p>
        </div>
        {!listLoading && !listError && groups.length > 0 && (
          <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={openCreate}>
            <Plus size={18} /> New group
          </button>
        )}
      </header>

      {listError && (
        <div className="alert-error" role="alert">
          <span className="flex items-center gap-2"><AlertCircle size={18} /> We could not load your groups. {listError}</span>
          <button type="button" onClick={() => void loadGroups(selectedId)} className="inline-flex items-center gap-1.5 font-semibold"><RefreshCw size={15} /> Try again</button>
        </div>
      )}

      {!listLoading && !listError && invitations.length > 0 && (
        <section className="section-card group-invitations" aria-labelledby="group-invitations-heading">
          <div className="mb-4">
            <h2 id="group-invitations-heading" className="section-title">Invitations to review</h2>
            <p className="mt-1 text-sm text-gray-500">You only join a group after you accept.</p>
          </div>
          {invitationError && <p className="mb-3 text-sm font-medium text-red-600" role="alert">{invitationError}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {invitations.map((invitation) => {
              const accepting = busyAction === `accept-${invitation.group_id}`;
              const declining = busyAction === `decline-${invitation.group_id}`;
              return (
                <article key={invitation.group_id} className="group-invitation-card" style={{ '--group-color': invitation.group_color } as CSSProperties}>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{invitation.group_name}</h3>
                    {invitation.group_description && <p className="mt-1 line-clamp-2 text-sm text-gray-500">{invitation.group_description}</p>}
                    <p className="mt-2 text-xs text-gray-500">{invitation.invited_by_name} invited you</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="btn-secondary" disabled={anyActionBusy} onClick={() => void respondToInvitation(invitation, false)}>{declining ? 'Declining…' : 'Decline'}</button>
                    <button type="button" className="btn-primary" disabled={anyActionBusy} onClick={() => void respondToInvitation(invitation, true)}>{accepting ? 'Joining…' : 'Accept'}</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!listLoading && !listError && (
        <section className="section-card public-groups" aria-labelledby="public-groups-heading">
          <div className="public-groups-header">
            <div>
              <h2 id="public-groups-heading" className="section-title">Discover public groups</h2>
              <p className="mt-1 text-sm text-gray-500">Browse open groups and join instantly. Private groups remain invitation-only.</p>
            </div>
            <Globe2 size={20} className="text-gray-400" aria-hidden="true" />
          </div>
          {publicGroupError && <p className="mt-3 text-sm font-medium text-red-600" role="alert">{publicGroupError}</p>}
          {publicGroups.length === 0 ? (
            <p className="public-groups-empty">There are no public groups available to join right now.</p>
          ) : (
            <div className="public-groups-grid">
              {publicGroups.map((item) => {
                const joining = busyAction === `join-${item.group_id}`;
                return (
                  <article key={item.group_id} className="public-group-card" style={{ '--group-color': item.color } as CSSProperties}>
                    <span className="public-group-mark"><Globe2 size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <h3>{item.name}</h3>
                      {item.description && <p>{item.description}</p>}
                      {item.people_count != null && <small>{item.people_count} occupied {item.people_count === 1 ? 'slot' : 'slots'}</small>}
                    </div>
                    <button type="button" className="btn-secondary" disabled={anyActionBusy} onClick={() => void joinPublicGroup(item)}>{joining ? 'Joining…' : 'Join group'}</button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {listLoading ? (
        <div aria-live="polite" aria-busy="true">
          <p className="mb-3 text-sm font-medium text-gray-500">Loading your groups…</p>
          <div className="grid gap-5 xl:grid-cols-[19rem_1fr]"><div className="skeleton h-72 rounded-3xl" /><div className="skeleton h-[30rem] rounded-3xl" /></div>
        </div>
      ) : listError ? null : groups.length === 0 ? (
        <div className="section-card empty-state min-h-80">
          <div className="empty-icon"><UsersRound size={27} /></div>
          <h2>You are not in a group yet</h2>
          <p>Create a group for your project, or accept an invitation above.</p>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openCreate}><Plus size={17} /> Create a group</button>
        </div>
      ) : (
        <div className="groups-workspace">
          <div className="group-mobile-picker xl:hidden">
            <label htmlFor="current-group">Current group</label>
            <div className="relative">
              <span className="group-picker-color" style={{ backgroundColor: groups.find((item) => item.group_id === selectedId)?.color }} />
              <select id="current-group" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {groups.map((item) => <option key={item.group_id} value={item.group_id}>{item.name} — {item.role === 'admin' ? 'Admin' : 'Member'}</option>)}
              </select>
              <ChevronDown size={18} aria-hidden="true" />
            </div>
          </div>

          <aside className="section-card hidden p-3 xl:sticky xl:top-10 xl:block" aria-label="Your groups">
            <div className="mb-2 flex items-center justify-between px-2 py-1"><h2 className="text-sm font-semibold">Your groups</h2><span className="text-xs text-gray-400">{groups.length}</span></div>
            <div className="space-y-1">
              {groups.map((item) => (
                <button key={item.group_id} type="button" className={`group-list-item ${selectedId === item.group_id ? 'group-list-item-active' : ''}`} onClick={() => setSelectedId(item.group_id)}>
                  <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="min-w-0 text-left"><strong className="block truncate text-sm">{item.name}</strong><small className="block truncate text-gray-500">{item.role === 'admin' ? 'Admin' : 'Member'} · {item.visibility === 'public' ? 'Public' : 'Private'}</small></span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0">
            {detailLoading ? (
              <div aria-live="polite" aria-busy="true"><p className="mb-3 text-sm font-medium text-gray-500">Opening group…</p><div className="skeleton h-[28rem] rounded-3xl" /></div>
            ) : detailError ? (
              <div className="section-card empty-state min-h-72" role="alert">
                <div className="empty-icon"><AlertCircle size={25} /></div>
                <h2>We could not open this group</h2>
                <p>{detailError}</p>
                <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => void loadGroup(selectedId)}><RefreshCw size={16} /> Try again</button>
              </div>
            ) : group ? (
              <section className="space-y-4">
                <div className="group-summary" style={{ '--group-color': group.color } as CSSProperties}>
                  <div className="group-summary-icon">{group.visibility === 'public' ? <Globe2 size={21} /> : <LockKeyhole size={21} />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                      <span>{group.visibility === 'public' ? 'Public group' : 'Private group'}</span><span aria-hidden="true">•</span><span>{isGroupAdmin ? 'Admin' : 'Member'}</span>{isCreator && <><span aria-hidden="true">•</span><span>Creator</span></>}
                    </div>
                    <h2>{group.name}</h2>
                    {group.description && <p>{group.description}</p>}
                  </div>
                  {isGroupAdmin ? (
                    <label className="group-visibility-toggle">
                      <span><strong>Public access</strong><small>{group.visibility === 'public' ? 'Anyone can discover and join' : 'Invitation only'}</small></span>
                      <input type="checkbox" role="switch" checked={group.visibility === 'public'} disabled={anyActionBusy} onChange={(event) => void updateVisibility(event.target.checked ? 'public' : 'private')} aria-label={`Make ${group.name} public`} />
                      <i aria-hidden="true" />
                    </label>
                  ) : (
                    <div className="group-people-count"><strong>{group.members.length}</strong><span>people</span></div>
                  )}
                </div>

                <div className="group-mobile-tabs" role="tablist" aria-label="Choose group section">
                  <button
                    ref={taskTabRef}
                    id="group-tasks-tab"
                    type="button"
                    role="tab"
                    aria-selected={activeView === 'tasks'}
                    aria-controls="group-tasks-panel"
                    tabIndex={activeView === 'tasks' ? 0 : -1}
                    className={activeView === 'tasks' ? 'group-tab-active' : ''}
                    onClick={() => activateTab('tasks')}
                    onKeyDown={handleTabKeyDown}
                  >Tasks <span>{openTaskCount}</span></button>
                  <button
                    ref={peopleTabRef}
                    id="group-people-tab"
                    type="button"
                    role="tab"
                    aria-selected={activeView === 'people'}
                    aria-controls="group-people-panel"
                    tabIndex={activeView === 'people' ? 0 : -1}
                    className={activeView === 'people' ? 'group-tab-active' : ''}
                    onClick={() => activateTab('people')}
                    onKeyDown={handleTabKeyDown}
                  >People <span>{group.members.length}</span></button>
                </div>

                <div>
                  <section id="group-tasks-panel" role="tabpanel" tabIndex={0} hidden={activeView !== 'tasks'} className="section-card p-0" aria-labelledby="group-tasks-tab">
                    <div className="group-section-header">
                      <div><h3 id="group-tasks-heading" className="section-title">Tasks</h3><p className="mt-1 text-sm text-gray-500">{openTaskCount === 0 ? 'Everything is done' : `${openTaskCount} ${openTaskCount === 1 ? 'task' : 'tasks'} left`}</p></div>
                      {group.tasks.length > 0 && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openTask}><Plus size={17} /> Add task</button>}
                    </div>
                    {taskActionError && <div className="group-inline-error" role="alert"><AlertCircle size={16} /><span>{taskActionError}</span><button type="button" onClick={() => setTaskActionError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
                    {group.tasks.length === 0 ? (
                      <div className="empty-state min-h-64"><div className="empty-icon"><CheckCircle2 size={25} /></div><h3>Add your first task</h3><p>Write down what the group needs to do and choose who is responsible.</p><button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openTask}><Plus size={17} /> Add the first task</button></div>
                    ) : (
                      <div className="divide-y" style={{ borderColor: 'var(--app-border)' }}>
                        {group.tasks.map((task) => {
                          const canManage = isGroupAdmin || task.created_by === user?.sub;
                          const canUpdate = canManage || task.assigned_to === user?.sub;
                          const canDelete = canManage;
                          const updating = busyAction === `toggle-${task.task_id}`;
                          const assigning = busyAction === `assign-${task.task_id}`;
                          const deleting = busyAction === `delete-task-${task.task_id}`;
                          const overdue = task.status !== 'completed' && new Date(task.deadline).getTime() < Date.now();
                          const permissionText = 'Only the assigned person, task creator, or group Admin can mark this complete.';
                          return (
                            <article key={task.task_id} className={`group-task-row ${task.status === 'completed' ? 'group-task-complete' : ''}`}>
                              {canUpdate ? (
                                <button type="button" disabled={anyActionBusy} className={`group-task-check ${task.status === 'completed' ? 'group-task-check-done' : ''}`} onClick={() => void toggleTask(task)} aria-label={`${task.status === 'completed' ? 'Reopen' : 'Complete'} ${task.title}`} title={task.status === 'completed' ? 'Mark as not done' : 'Mark as complete'}>{updating ? <LoaderCircle className="animate-spin" size={17} /> : task.status === 'completed' ? <Check size={17} /> : null}</button>
                              ) : (
                                <span className="group-task-readonly" title={permissionText} aria-label={permissionText}><LockKeyhole size={16} /></span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><h4 className={task.status === 'completed' ? 'line-through' : ''}>{task.title}</h4>{overdue && <span className="status-pill status-red">Overdue</span>}{task.status === 'in_progress' && <span className="status-pill status-blue">In progress</span>}</div>
                                {task.description && <p className="mt-1 line-clamp-2 text-sm leading-5 text-gray-500">{task.description}</p>}
                                <div className="group-task-assignment-row">
                                  <span className="group-task-assignment-label">Assigned to</span>
                                  {canManage ? (
                                    <div className="group-task-assignment-control">
                                      <select id={`task-assignee-${task.task_id}`} value={task.assigned_to || ''} disabled={anyActionBusy} onChange={(event) => void assignTask(task, event.target.value)} aria-label={`Assign ${task.title}`}>
                                        <option value="">No one yet</option>
                                        {group.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user?.sub ? ' (me)' : ''}</option>)}
                                      </select>
                                      {assigning && <LoaderCircle className="animate-spin" size={15} aria-label="Saving assignment" />}
                                    </div>
                                  ) : <strong>{task.assigned_to ? memberNames.get(task.assigned_to) || 'Group member' : 'No one yet'}</strong>}
                                </div>
                                <div className="group-task-meta">
                                  <span><CalendarClock size={13} /> {new Date(task.deadline).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                  <span>Added by {task.created_by_name}</span>
                                </div>
                                {!canUpdate && <p className="group-task-permission">View only · {permissionText}</p>}
                              </div>
                              {canDelete && <button type="button" disabled={anyActionBusy} className="group-task-delete" onClick={() => void deleteTask(task)}>{deleting ? <LoaderCircle className="animate-spin" size={16} aria-label="Deleting task" /> : <><Trash2 size={15} /> Delete</>}</button>}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section id="group-people-panel" role="tabpanel" tabIndex={0} hidden={activeView !== 'people'} className="section-card" aria-labelledby="group-people-tab">
                    <div className="mb-4 flex items-center justify-between"><div><h3 id="group-people-heading" className="section-title">People</h3><p className="mt-1 text-xs text-gray-500">{group.members.length} in this group</p></div><UsersRound size={18} className="text-gray-400" /></div>
                    <ul className="space-y-3">
                      {group.members.map((member) => {
                        const removing = busyAction === `remove-${member.user_id}`;
                        const changingRole = busyAction === `role-${member.user_id}`;
                        const creator = member.user_id === group.owner_id;
                        const canAdministerMember = isGroupAdmin && !creator;
                        const canLeave = member.user_id === user?.sub && !creator;
                        return (
                          <li key={member.user_id} className="group-member-row">
                            <span className="member-avatar" style={{ backgroundColor: group.color }}>{member.display_name[0]?.toUpperCase() || 'U'}</span>
                            <span className="min-w-0 flex-1"><strong>{member.display_name}{creator && <Crown size={13} className="text-amber-500" aria-label="Group creator" />}</strong><small>{member.role === 'admin' ? 'Admin' : 'Member'}{creator ? ' · Creator' : ''}</small></span>
                            {canAdministerMember ? (
                              <div className="group-member-actions">
                                <label><span className="sr-only">Role for {member.display_name}</span><select value={member.role} disabled={anyActionBusy} onChange={(event) => void updateMemberRole(member, event.target.value as GroupRole)}><option value="member">Member</option><option value="admin">Admin</option></select></label>
                                <button type="button" disabled={anyActionBusy} className="group-member-remove" onClick={() => void removeMember(member)}>{removing ? 'Removing…' : <><UserMinus size={14} /> {canLeave ? 'Leave' : 'Remove'}</>}</button>
                                {changingRole && <LoaderCircle className="animate-spin text-gray-500" size={16} aria-label="Saving role" />}
                              </div>
                            ) : canLeave ? (
                              <button type="button" disabled={anyActionBusy} className="group-member-remove" onClick={() => void removeMember(member)}>{removing ? 'Leaving…' : <><UserMinus size={14} /> Leave</>}</button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>

                    {memberError && <p className="group-member-message text-red-600" role="alert"><AlertCircle size={15} /> {memberError}</p>}
                    {memberSuccess && <p className="group-member-message text-green-700" role="status"><CheckCircle2 size={15} /> {memberSuccess}</p>}

                    {isGroupAdmin && (
                      <form className="group-invite-form" onSubmit={sendInvitation}>
                        <label htmlFor="member-email" className="field-label"><span className="inline-flex items-center gap-1.5"><UserPlus size={15} /> Classmate&apos;s account email</span></label>
                        <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /><input id="member-email" required maxLength={254} type="email" className="input-field pl-9 text-sm" placeholder="student@example.com" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></div>
                        <p className="form-help">If eligible, this saves an in-app invitation and attempts an email. Delivery is not guaranteed, and for privacy we will not confirm whether the address has an account.</p>
                        <button type="submit" disabled={anyActionBusy} className="btn-secondary mt-3 w-full">{busyAction === 'send-invitation' ? 'Sending…' : 'Send invitation'}</button>
                      </form>
                    )}

                    <details className="group-options">
                      <summary><span><MoreHorizontal size={17} /> Group options</span><ChevronDown size={17} /></summary>
                      <div className="group-options-body">
                        {isGroupAdmin ? (
                          <>
                            <button type="button" disabled={anyActionBusy} onClick={() => void clearPendingInvitations()}>{busyAction === 'clear-invitations' ? 'Cancelling…' : 'Cancel unaccepted invitations'}</button>
                            {isCreator && <div className="group-danger-zone"><p>Danger zone</p><button type="button" disabled={anyActionBusy} onClick={() => void deleteGroup()}><Trash2 size={15} /> {busyAction === 'delete-group' ? 'Deleting group…' : 'Delete group'}</button></div>}
                          </>
                        ) : null}
                      </div>
                    </details>
                  </section>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      )}

      {createOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !dialogBusyRef.current && setCreateOpen(false)}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-group-heading" className="modal-panel max-w-lg">
            <div className="modal-header"><div><p className="eyebrow mb-1">New group</p><h2 id="create-group-heading" className="text-xl font-semibold">Create a group</h2><p className="mt-1 text-sm text-gray-500">Give your project team one place for tasks and updates.</p></div><button type="button" className="icon-button -mr-2" disabled={dialogBusyRef.current} onClick={() => setCreateOpen(false)} aria-label="Close"><X size={20} /></button></div>
            <form onSubmit={createGroup}>
              <div className="modal-content space-y-5">
                {createError && <p className="text-sm font-medium text-red-600" role="alert">{createError}</p>}
                <div><label htmlFor="group-name" className="field-label">Group name</label><input id="group-name" data-autofocus required maxLength={80} className="input-field" placeholder="e.g. Capstone project team" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></div>
                <div><label htmlFor="group-description" className="field-label">What are you working on? <span className="font-normal text-gray-400">Optional</span></label><textarea id="group-description" rows={3} maxLength={500} className="input-field resize-none" placeholder="e.g. Plan and deliver our final presentation" value={groupForm.description} onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })} /></div>
                <fieldset><legend className="field-label"><span>Group color</span><span className="optional-label">Optional</span></legend><div className="flex flex-wrap gap-3">{groupColors.map((color) => <button key={color.value} type="button" className={`color-choice ${groupForm.color === color.value ? 'color-choice-active' : ''}`} style={{ backgroundColor: color.value }} aria-label={`${color.label}${groupForm.color === color.value ? ', selected' : ''}`} aria-pressed={groupForm.color === color.value} title={color.label} onClick={() => setGroupForm({ ...groupForm, color: color.value })}>{groupForm.color === color.value && <Check size={17} />}</button>)}</div></fieldset>
                <fieldset className="group-visibility-fieldset">
                  <legend>Group visibility</legend>
                  <label className="group-create-visibility">
                    <span className="group-create-visibility-icon">{groupForm.visibility === 'public' ? <Globe2 size={18} /> : <LockKeyhole size={18} />}</span>
                    <span className="min-w-0 flex-1"><strong>{groupForm.visibility === 'public' ? 'Public group' : 'Private group'}</strong><small>{groupForm.visibility === 'public' ? 'Anyone using the app can discover and join this group.' : 'Only invited people can see and join this group.'}</small></span>
                    <input type="checkbox" role="switch" checked={groupForm.visibility === 'public'} onChange={(event) => setGroupForm({ ...groupForm, visibility: event.target.checked ? 'public' : 'private' })} aria-label="Public group" aria-describedby="group-visibility-help" />
                    <i aria-hidden="true" />
                  </label>
                  <p id="group-visibility-help" className="form-help">Groups start private. You can change visibility later if you are an Admin.</p>
                </fieldset>
              </div>
              <div className="modal-actions"><button type="button" className="btn-secondary" disabled={dialogBusyRef.current} onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="btn-primary min-w-32" disabled={dialogBusyRef.current}>{busyAction === 'create-group' ? <><LoaderCircle className="animate-spin" size={18} /> Creating…</> : 'Create group'}</button></div>
            </form>
          </div>
        </div>
      )}

      {taskOpen && group && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !dialogBusyRef.current && setTaskOpen(false)}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-group-task-heading" className="modal-panel max-w-xl">
            <div className="modal-header"><div><p className="eyebrow mb-1">{group.name}</p><h2 id="create-group-task-heading" className="text-xl font-semibold">Add a task</h2><p className="mt-1 text-sm text-gray-500">Make the next step clear and choose who is responsible.</p></div><button type="button" className="icon-button -mr-2" disabled={dialogBusyRef.current} onClick={() => setTaskOpen(false)} aria-label="Close"><X size={20} /></button></div>
            <form onSubmit={createTask}>
              <div className="modal-content space-y-5">
                {taskError && <p className="text-sm font-medium text-red-600" role="alert">{taskError}</p>}
                <div><label htmlFor="group-task-title" className="field-label">What needs to be done?</label><input id="group-task-title" data-autofocus required maxLength={200} className="input-field" placeholder="e.g. Draft the presentation slides" value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /></div>
                <div><label htmlFor="group-task-description" className="field-label">Notes <span className="font-normal text-gray-400">Optional</span></label><textarea id="group-task-description" rows={3} maxLength={2000} className="input-field resize-none" placeholder="Add links, requirements, or helpful context" value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} /></div>
                <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="group-task-deadline" className="field-label">Due date</label><input id="group-task-deadline" required type="datetime-local" className="input-field" value={taskForm.deadline} onChange={(event) => setTaskForm({ ...taskForm, deadline: event.target.value })} /></div><div><label htmlFor="group-task-assignee" className="field-label">Who is responsible?</label><select id="group-task-assignee" className="input-field" value={taskForm.assignedTo} onChange={(event) => setTaskForm({ ...taskForm, assignedTo: event.target.value })}><option value="">No one yet (unassigned)</option>{group.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user?.sub ? ' (me)' : ''}</option>)}</select><p className="form-help">Choose one person, or leave it unassigned for now.</p></div></div>
              </div>
              <div className="modal-actions"><button type="button" className="btn-secondary" disabled={dialogBusyRef.current} onClick={() => setTaskOpen(false)}>Cancel</button><button type="submit" className="btn-primary min-w-28" disabled={dialogBusyRef.current}>{busyAction === 'create-task' ? <><LoaderCircle className="animate-spin" size={17} /> Adding…</> : 'Add task'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Groups;
