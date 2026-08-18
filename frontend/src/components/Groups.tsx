import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Crown,
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
import type { CollaborativeGroup, GroupInvitation, GroupMember, GroupSummary, GroupTask } from '../types/api';

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
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [group, setGroup] = useState<CollaborativeGroup | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [taskActionError, setTaskActionError] = useState('');
  const [invitationError, setInvitationError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [taskError, setTaskError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [mobileView, setMobileView] = useState<'tasks' | 'people'>('tasks');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberError, setMemberError] = useState('');
  const [memberSuccess, setMemberSuccess] = useState('');
  const [groupForm, setGroupForm] = useState({ name: '', description: '', color: groupColors[0].value });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', deadline: toDateTimeLocal(), assignedTo: '' });
  const detailSequence = useRef(0);
  const selectedIdRef = useRef('');
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

  useEffect(() => { void loadGroups(); }, []);
  useEffect(() => {
    setMobileView('tasks');
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
  const isOwner = currentMember?.role === 'owner';
  const openTaskCount = group?.tasks.filter((task) => task.status !== 'completed').length || 0;
  const anyActionBusy = Boolean(busyAction);

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
      setGroupForm({ name: '', description: '', color: groupColors[0].value });
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
      setMemberSuccess('Invitation sent if this email belongs to an account. They will join only after accepting.');
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
        setInvitations((current) => current.filter((item) => item.group_id !== invitation.group_id));
        await loadGroups(invitation.group_id);
      } else {
        await groupsApi.declineInvitation(invitation.group_id);
        setInvitations((current) => current.filter((item) => item.group_id !== invitation.group_id));
      }
    } catch (respondError) {
      setInvitationError(errorMessage(respondError));
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
          <p className="page-subtitle">Create a private group, invite classmates, and track who is doing what.</p>
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
                {groups.map((item) => <option key={item.group_id} value={item.group_id}>{item.name}{item.role === 'owner' ? ' — you manage' : ''}</option>)}
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
                  <span className="min-w-0 text-left"><strong className="block truncate text-sm">{item.name}</strong><small className="block truncate text-gray-500">{item.role === 'owner' ? 'You manage this group' : 'Member'}</small></span>
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
                  <div className="group-summary-icon"><LockKeyhole size={21} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                      <span>Private group</span><span aria-hidden="true">•</span><span>{isOwner ? 'You manage this group' : 'You are a member'}</span>
                    </div>
                    <h2>{group.name}</h2>
                    {group.description && <p>{group.description}</p>}
                  </div>
                  <button type="button" className="group-people-shortcut lg:hidden" onClick={() => setMobileView('people')}><UsersRound size={17} /> {group.members.length} people</button>
                  <div className="hidden text-right lg:block"><strong className="block text-lg">{group.members.length}</strong><span className="text-xs text-gray-500">people</span></div>
                </div>

                <div className="group-mobile-tabs lg:hidden" aria-label="Choose group section">
                  <button type="button" aria-pressed={mobileView === 'tasks'} className={mobileView === 'tasks' ? 'group-tab-active' : ''} onClick={() => setMobileView('tasks')}>Tasks <span>{openTaskCount}</span></button>
                  <button type="button" aria-pressed={mobileView === 'people'} className={mobileView === 'people' ? 'group-tab-active' : ''} onClick={() => setMobileView('people')}>People <span>{group.members.length}</span></button>
                </div>

                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
                  <section className={`${mobileView === 'tasks' ? 'block' : 'hidden'} section-card p-0 lg:block`} aria-labelledby="group-tasks-heading">
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
                          const canManage = isOwner || task.created_by === user?.sub;
                          const canUpdate = canManage || task.assigned_to === user?.sub;
                          const canDelete = canManage;
                          const updating = busyAction === `toggle-${task.task_id}`;
                          const assigning = busyAction === `assign-${task.task_id}`;
                          const deleting = busyAction === `delete-task-${task.task_id}`;
                          const overdue = task.status !== 'completed' && new Date(task.deadline).getTime() < Date.now();
                          const permissionText = 'Only the assigned person, task creator, or group manager can mark this complete.';
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
                                <div className="group-task-meta">
                                  <span><CalendarClock size={13} /> {new Date(task.deadline).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                                  {canManage ? (
                                    <label className="group-task-assignee">
                                      <span>Assigned to</span>
                                      <select value={task.assigned_to || ''} disabled={anyActionBusy} onChange={(event) => void assignTask(task, event.target.value)} aria-label={`Assign ${task.title}`}>
                                        <option value="">No one yet</option>
                                        {group.members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user?.sub ? ' (me)' : ''}</option>)}
                                      </select>
                                      {assigning && <LoaderCircle className="animate-spin" size={13} aria-label="Saving assignment" />}
                                    </label>
                                  ) : <span>{task.assigned_to ? `Assigned to ${memberNames.get(task.assigned_to) || 'Group member'}` : 'No one assigned yet'}</span>}
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

                  <aside className={`${mobileView === 'people' ? 'block' : 'hidden'} section-card lg:block`} aria-labelledby="group-people-heading">
                    <div className="mb-4 flex items-center justify-between"><div><h3 id="group-people-heading" className="section-title">People</h3><p className="mt-1 text-xs text-gray-500">{group.members.length} in this group</p></div><UsersRound size={18} className="text-gray-400" /></div>
                    <ul className="space-y-3">
                      {group.members.map((member) => {
                        const removing = busyAction === `remove-${member.user_id}`;
                        return (
                          <li key={member.user_id} className="group-member-row">
                            <span className="member-avatar" style={{ backgroundColor: group.color }}>{member.display_name[0]?.toUpperCase() || 'U'}</span>
                            <span className="min-w-0 flex-1"><strong>{member.display_name}{member.role === 'owner' && <Crown size={13} className="text-amber-500" />}</strong><small>{member.role === 'owner' ? 'Group manager' : 'Member'}</small></span>
                            {member.role !== 'owner' && isOwner && <button type="button" disabled={anyActionBusy} className="group-member-remove" onClick={() => void removeMember(member)}>{removing ? 'Removing…' : <><UserMinus size={14} /> Remove</>}</button>}
                          </li>
                        );
                      })}
                    </ul>

                    {memberError && <p className="group-member-message text-red-600" role="alert"><AlertCircle size={15} /> {memberError}</p>}
                    {memberSuccess && <p className="group-member-message text-green-700" role="status"><CheckCircle2 size={15} /> {memberSuccess}</p>}

                    {isOwner && (
                      <form className="group-invite-form" onSubmit={sendInvitation}>
                        <label htmlFor="member-email" className="field-label"><span className="inline-flex items-center gap-1.5"><UserPlus size={15} /> Classmate&apos;s account email</span></label>
                        <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} /><input id="member-email" required maxLength={254} type="email" className="input-field pl-9 text-sm" placeholder="student@example.com" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></div>
                        <p className="form-help">Use the email they use for this app. For privacy, we will not confirm whether an email has an account.</p>
                        <button type="submit" disabled={anyActionBusy} className="btn-secondary mt-3 w-full">{busyAction === 'send-invitation' ? 'Sending…' : 'Send invitation'}</button>
                      </form>
                    )}

                    <details className="group-options">
                      <summary><span><MoreHorizontal size={17} /> Group options</span><ChevronDown size={17} /></summary>
                      <div className="group-options-body">
                        {isOwner ? (
                          <>
                            <button type="button" disabled={anyActionBusy} onClick={() => void clearPendingInvitations()}>{busyAction === 'clear-invitations' ? 'Cancelling…' : 'Cancel unaccepted invitations'}</button>
                            <div className="group-danger-zone"><p>Danger zone</p><button type="button" disabled={anyActionBusy} onClick={() => void deleteGroup()}><Trash2 size={15} /> {busyAction === 'delete-group' ? 'Deleting group…' : 'Delete group'}</button></div>
                          </>
                        ) : currentMember?.role === 'member' ? (
                          <button type="button" disabled={anyActionBusy} className="text-red-600" onClick={() => void removeMember(currentMember)}>Leave this group</button>
                        ) : null}
                      </div>
                    </details>
                  </aside>
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
                <fieldset><legend className="field-label">Group color <span className="font-normal text-gray-400">Optional</span></legend><div className="flex flex-wrap gap-3">{groupColors.map((color) => <button key={color.value} type="button" className={`color-choice ${groupForm.color === color.value ? 'color-choice-active' : ''}`} style={{ backgroundColor: color.value }} aria-label={`${color.label}${groupForm.color === color.value ? ', selected' : ''}`} aria-pressed={groupForm.color === color.value} title={color.label} onClick={() => setGroupForm({ ...groupForm, color: color.value })}>{groupForm.color === color.value && <Check size={17} />}</button>)}</div></fieldset>
                <div className="group-privacy-note"><LockKeyhole size={18} /><p><strong>Private by default</strong><span>Only people you invite can see this group after they accept.</span></p></div>
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
