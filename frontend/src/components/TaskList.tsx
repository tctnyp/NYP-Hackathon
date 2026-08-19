import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { modulesApi, tasksApi } from '../services/api';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Edit2,
  ListFilter,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { Module, Task, TaskStatus } from '../types/api';
import TaskForm from './TaskForm';
import CalendarActions from './CalendarActions';

type TaskFilter = TaskStatus | 'all';
type TaskSort = 'deadline' | 'priority' | 'newest';

const filterOptions: Array<{ value: TaskFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'not_started', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
];

function deadlineLabel(deadlineValue: string) {
  const deadline = new Date(deadlineValue);
  const now = new Date();
  if (deadline.getTime() < now.getTime()) return { label: 'Overdue', tone: 'text-red-600' };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return { label: 'Due today', tone: 'text-orange-600' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'text-orange-600' };
  return {
    label: deadline.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: deadline.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    }),
    tone: 'text-gray-500',
  };
}

function TaskList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestSequence = useRef(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [modulesError, setModulesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [sort, setSort] = useState<TaskSort>('deadline');
  const [query, setQuery] = useState('');
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  useEffect(() => { void loadTasks(); }, [filter]);

  useEffect(() => {
    modulesApi.getAll()
      .then((response) => {
        setModules(response.data.data.modules || []);
        setModulesError('');
      })
      .catch((loadError) => {
        console.error('Error loading modules:', loadError);
        setModulesError('Modules are temporarily unavailable. You can still save without one.');
      });
  }, []);

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setEditingTask(undefined);
      setFormError('');
      setFormOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadTasks = async () => {
    const currentRequest = ++requestSequence.current;
    try {
      setLoading(true);
      setPageError('');
      const params = filter !== 'all' && filter !== 'overdue' ? { status: filter } : {};
      const response = await tasksApi.getAll(params);
      if (currentRequest === requestSequence.current) setTasks(response.data.data.tasks || []);
    } catch (loadError) {
      console.error('Error loading tasks:', loadError);
      if (currentRequest === requestSequence.current) {
        setPageError('We couldn’t load your tasks. Check your connection and try again.');
      }
    } finally {
      if (currentRequest === requestSequence.current) setLoading(false);
    }
  };

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks
      .filter((task) => filter !== 'overdue' || (task.status !== 'completed' && new Date(task.deadline).getTime() < Date.now()))
      .filter((task) => !normalizedQuery || `${task.title} ${task.description || ''} ${task.task_type}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => sort === 'priority'
        ? b.priority_score - a.priority_score
        : sort === 'newest'
          ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          : new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [filter, query, sort, tasks]);

  const openCreateForm = () => { setEditingTask(undefined); setFormError(''); setFormOpen(true); };
  const openEditForm = (task: Task) => { setEditingTask(task); setFormError(''); setFormOpen(true); };
  const closeForm = () => {
    if (!submitting) {
      setFormOpen(false);
      setEditingTask(undefined);
      setFormError('');
    }
  };

  const saveTask = async (data: Partial<Task>) => {
    try {
      setSubmitting(true);
      setFormError('');
      if (editingTask) await tasksApi.update(editingTask.task_id, data);
      else await tasksApi.create(data);
      setFormOpen(false);
      setEditingTask(undefined);
      await loadTasks();
    } catch (saveError) {
      console.error('Error saving task:', saveError);
      setFormError(`We couldn’t ${editingTask ? 'update' : 'create'} the task. Check the details and try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  const updateTaskStatus = async (task: Task) => {
    const status: TaskStatus = task.status === 'completed'
      ? 'not_started'
      : task.status === 'in_progress'
        ? 'completed'
        : 'in_progress';
    const progress_percentage = status === 'completed' ? 100 : status === 'not_started' ? 0 : 1;

    try {
      setUpdatingTaskId(task.task_id);
      setPageError('');
      const response = await tasksApi.update(task.task_id, { status, progress_percentage });
      const updatedTask = response.data.data.task;
      setTasks((current) => current
        .map((item) => item.task_id === task.task_id ? updatedTask : item)
        .filter((item) => filter === 'all' || filter === 'overdue' || item.status === filter));
    } catch (updateError) {
      console.error('Error updating task status:', updateError);
      setPageError('We couldn’t update that task. Please try again.');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const deleteTask = async (task: Task) => {
    if (!window.confirm(`Delete “${task.title}”? This can’t be undone.`)) return;
    try {
      setDeletingTaskId(task.task_id);
      setPageError('');
      await tasksApi.delete(task.task_id);
      setTasks((current) => current.filter((item) => item.task_id !== task.task_id));
    } catch (deleteError) {
      console.error('Error deleting task:', deleteError);
      setPageError('We couldn’t delete that task. Please try again.');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const statusBadge: Record<TaskStatus, string> = {
    not_started: 'status-neutral',
    in_progress: 'status-blue',
    completed: 'status-green',
    overdue: 'status-red',
  };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow"><CheckCircle2 size={14} /> Your workspace</p>
          <h1 className="page-title">My tasks</h1>
          <p className="page-subtitle">Capture, prioritize, and finish your work in one place.</p>
        </div>
        <button onClick={openCreateForm} className="btn-primary inline-flex items-center justify-center gap-2">
          <Plus size={18} /> New task
        </button>
      </header>

      <section className="section-card p-3 sm:p-4" aria-label="Task filters">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="segmented-control flex-1 overflow-x-auto">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={filter === option.value ? 'segmented-active' : ''}
                aria-pressed={filter === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="search-field min-w-0 sm:min-w-64">
              <Search size={17} />
              <span className="sr-only">Search tasks</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" />
            </label>
            <label className="select-field">
              <ListFilter size={16} />
              <span className="sr-only">Sort tasks</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as TaskSort)}>
                <option value="deadline">Due date</option>
                <option value="priority">Priority</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {pageError && (
        <div className="alert-error" role="alert">
          <span className="flex items-center gap-2"><AlertCircle size={18} /> {pageError}</span>
          {!formOpen && (
            <button type="button" onClick={() => void loadTasks()} className="inline-flex items-center gap-1.5 font-semibold">
              <RefreshCw size={15} /> Retry
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-label="Loading tasks">
          {[0, 1, 2].map((item) => <div key={item} className="skeleton h-36 rounded-2xl" />)}
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="section-card empty-state min-h-80">
          <div className="empty-icon">{query ? <Search size={25} /> : <CheckCircle2 size={25} />}</div>
          <h2>{query ? 'No matching tasks' : filter === 'completed' ? 'Nothing completed yet' : 'Your list is clear'}</h2>
          <p>{query ? 'Try a different search term or clear your filters.' : 'Add your first task and turn a big goal into a simple next step.'}</p>
          {query ? (
            <button type="button" className="btn-secondary" onClick={() => setQuery('')}>Clear search</button>
          ) : (
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openCreateForm}>
              <Plus size={17} /> Create task
            </button>
          )}
        </div>
      ) : (
        <section className="space-y-3" aria-live="polite" aria-label={`${visibleTasks.length} tasks`}>
          {visibleTasks.map((task) => {
            const deadline = deadlineLabel(task.deadline);
            const isUpdating = updatingTaskId === task.task_id;
            const actionLabel = task.status === 'completed' ? 'Reopen' : task.status === 'in_progress' ? 'Complete' : 'Start';
            const ActionIcon = task.status === 'completed' ? RotateCcw : task.status === 'in_progress' ? CheckCircle2 : Play;

            return (
              <article key={task.task_id} className="task-card group">
                <div className={`task-accent ${task.status === 'overdue' ? 'bg-red-500' : task.status === 'completed' ? 'bg-green-500' : task.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[1.02rem] font-semibold tracking-tight">{task.title}</h2>
                        <span className={`status-pill ${statusBadge[task.status]}`}>
                          {task.status === 'not_started' ? 'To do' : task.status.replace('_', ' ')}
                        </span>
                      </div>
                      {task.description && <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-gray-500">{task.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                      <CalendarActions task={task} />
                      <button type="button" onClick={() => openEditForm(task)} className="icon-button" aria-label={`Edit ${task.title}`} title="Edit">
                        <Edit2 size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTask(task)}
                        disabled={deletingTaskId === task.task_id}
                        className="icon-button hover:text-red-600 disabled:opacity-40"
                        aria-label={`Delete ${task.title}`}
                        title="Delete"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-gray-500">
                    <span className={`inline-flex items-center gap-1.5 ${deadline.tone}`}><CalendarClock size={14} /> {deadline.label}</span>
                    <span className="capitalize">{task.task_type.replace('_', ' ')}</span>
                    <span className="capitalize">{task.priority.replace('_', ' ')} priority</span>
                    {task.estimated_hours != null && <span>Estimated: {task.estimated_hours} {task.estimated_hours === 1 ? 'hour' : 'hours'}</span>}
                  </div>
                  <div className="mt-4 flex justify-end border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
                    <button
                      type="button"
                      className={`${task.status === 'completed' ? 'btn-secondary' : 'btn-primary'} inline-flex items-center justify-center gap-2`}
                      onClick={() => void updateTaskStatus(task)}
                      disabled={isUpdating}
                      aria-label={`${actionLabel} ${task.title}`}
                    >
                      {isUpdating ? <LoaderCircle className="animate-spin" size={17} /> : <ActionIcon size={17} />}
                      {isUpdating ? 'Updating…' : actionLabel}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {formOpen && (
        <TaskForm
          task={editingTask}
          modules={modules}
          modulesError={modulesError}
          submitting={submitting}
          error={formError}
          onClose={closeForm}
          onSubmit={saveTask}
        />
      )}
    </div>
  );
}

export default TaskList;
