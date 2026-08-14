import { useEffect, useState } from 'react';
import { modulesApi, tasksApi } from '../services/api';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import type { Module, Task, TaskStatus } from '../types/api';
import TaskForm from './TaskForm';

type TaskFilter = TaskStatus | 'all';

function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, [filter]);

  useEffect(() => {
    modulesApi.getAll()
      .then((response) => setModules(response.data.data.modules || []))
      .catch((loadError) => console.error('Error loading modules:', loadError));
  }, []);

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError('');
      const params = filter !== 'all' ? { status: filter } : {};
      const response = await tasksApi.getAll(params);
      setTasks(response.data.data.tasks || []);
    } catch (loadError) {
      console.error('Error loading tasks:', loadError);
      setError('Unable to load tasks. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openCreateForm = () => {
    setEditingTask(undefined);
    setError('');
    setFormOpen(true);
  };

  const openEditForm = (task: Task) => {
    setEditingTask(task);
    setError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    if (submitting) return;
    setFormOpen(false);
    setEditingTask(undefined);
  };

  const saveTask = async (data: Partial<Task>) => {
    try {
      setSubmitting(true);
      setError('');
      if (editingTask) {
        await tasksApi.update(editingTask.task_id, data);
      } else {
        await tasksApi.create(data);
      }
      setFormOpen(false);
      setEditingTask(undefined);
      await loadTasks();
    } catch (saveError) {
      console.error('Error saving task:', saveError);
      setError(`Unable to ${editingTask ? 'update' : 'create'} the task. Please check the details and try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTask = async (task: Task) => {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;

    try {
      setDeletingTaskId(task.task_id);
      setError('');
      await tasksApi.delete(task.task_id);
      setTasks((currentTasks) => currentTasks.filter((item) => item.task_id !== task.task_id));
    } catch (deleteError) {
      console.error('Error deleting task:', deleteError);
      setError('Unable to delete the task. Please try again.');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    const colors: Record<TaskStatus, string> = {
      not_started: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-blue-100 text-blue-700',
      completed: 'bg-green-100 text-green-700',
      overdue: 'bg-red-100 text-red-700',
    };
    return colors[status];
  };

  const filters: TaskFilter[] = ['all', 'not_started', 'in_progress', 'overdue', 'completed'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <button onClick={openCreateForm} className="btn-primary flex items-center gap-2">
          <Plus size={20} />
          New Task
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 capitalize ${
              filter === status ? 'bg-primary-600 text-white' : 'border bg-white text-gray-700'
            }`}
          >
            {status.replace('_', ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700" role="alert">
          <span>{error}</span>
          {!formOpen && <button type="button" onClick={loadTasks} className="font-medium underline">Retry</button>}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.length === 0 ? (
            <div className="rounded-lg border bg-white py-12 text-center">
              <p className="text-gray-500">No tasks found</p>
              <button type="button" onClick={openCreateForm} className="mt-3 font-medium text-primary-600 hover:underline">Create your first task</button>
            </div>
          ) : (
            tasks.map((task) => (
              <article key={task.task_id} className="rounded-lg border bg-white p-6 transition hover:shadow-md">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{task.title}</h2>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusBadge(task.status)}`}>
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>
                    {task.description && <p className="mt-2 text-gray-600">{task.description}</p>}
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                      <span className="capitalize">{task.task_type}</span>
                      <span className="capitalize">{task.difficulty.replace('_', ' ')}</span>
                      {task.estimated_hours != null && <span>{task.estimated_hours}h estimated</span>}
                      <span>{task.progress_percentage}% complete</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <time className="text-sm font-medium" dateTime={task.deadline}>
                      {new Date(task.deadline).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEditForm(task)} className="rounded-lg p-2 text-gray-500 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${task.title}`}>
                        <Edit2 size={18} />
                      </button>
                      <button type="button" onClick={() => deleteTask(task)} disabled={deletingTaskId === task.task_id} className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Delete ${task.title}`}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {formOpen && (
        <TaskForm
          task={editingTask}
          modules={modules}
          submitting={submitting}
          onClose={closeForm}
          onSubmit={saveTask}
        />
      )}
    </div>
  );
}

export default TaskList;
