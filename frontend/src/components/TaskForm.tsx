import { FormEvent, useState } from 'react';
import { X } from 'lucide-react';
import type { Module, Task, TaskDifficulty, TaskStatus, TaskType } from '../types/api';

interface TaskFormProps {
  task?: Task;
  modules: Module[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Task>) => Promise<void>;
}

interface FormState {
  title: string;
  description: string;
  taskType: TaskType;
  deadline: string;
  moduleId: string;
  estimatedHours: string;
  gradeWeight: string;
  difficulty: TaskDifficulty;
  isGroupWork: boolean;
  status: TaskStatus;
  progressPercentage: string;
}

const taskTypes: TaskType[] = [
  'assignment',
  'test',
  'exam',
  'project',
  'presentation',
  'report',
  'competition',
  'other',
];

const difficulties: TaskDifficulty[] = ['easy', 'medium', 'hard', 'very_hard'];
const editableStatuses: TaskStatus[] = ['not_started', 'in_progress', 'completed'];

function toDateTimeLocal(value?: string) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function TaskForm({ task, modules, submitting, onClose, onSubmit }: TaskFormProps) {
  const [form, setForm] = useState<FormState>({
    title: task?.title || '',
    description: task?.description || '',
    taskType: task?.task_type || 'assignment',
    deadline: toDateTimeLocal(task?.deadline),
    moduleId: task?.module_id || '',
    estimatedHours: task?.estimated_hours?.toString() || '',
    gradeWeight: task?.grade_weight?.toString() || '',
    difficulty: task?.difficulty || 'medium',
    isGroupWork: task?.is_group_work || false,
    status: task?.status === 'overdue' ? 'in_progress' : task?.status || 'not_started',
    progressPercentage: task?.progress_percentage?.toString() || '0',
  });

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: Partial<Task> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      task_type: form.taskType,
      deadline: new Date(form.deadline).toISOString(),
      module_id: form.moduleId || null,
      estimated_hours: form.estimatedHours ? Number(form.estimatedHours) : null,
      grade_weight: form.gradeWeight ? Number(form.gradeWeight) : null,
      difficulty: form.difficulty,
      is_group_work: form.isGroupWork,
    };

    if (task) {
      payload.status = form.status;
      payload.progress_percentage = form.status === 'completed' ? 100 : Number(form.progressPercentage);
    }

    await onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
          <h2 id="task-form-title" className="text-xl font-semibold">
            {task ? 'Edit Task' : 'Create Task'}
          </h2>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close task form">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div>
            <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-gray-700">Title</label>
            <input id="task-title" required maxLength={200} className="input-field" value={form.title} onChange={(event) => updateForm('title', event.target.value)} />
          </div>

          <div>
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea id="task-description" rows={3} className="input-field" value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="task-type" className="mb-1 block text-sm font-medium text-gray-700">Type</label>
              <select id="task-type" className="input-field capitalize" value={form.taskType} onChange={(event) => updateForm('taskType', event.target.value as TaskType)}>
                {taskTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="task-deadline" className="mb-1 block text-sm font-medium text-gray-700">Deadline</label>
              <input id="task-deadline" type="datetime-local" required className="input-field" value={form.deadline} onChange={(event) => updateForm('deadline', event.target.value)} />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="task-module" className="mb-1 block text-sm font-medium text-gray-700">Module</label>
              <select id="task-module" className="input-field" value={form.moduleId} onChange={(event) => updateForm('moduleId', event.target.value)}>
                <option value="">No module</option>
                {modules.map((module) => <option key={module.module_id} value={module.module_id}>{module.module_code} — {module.module_name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="task-difficulty" className="mb-1 block text-sm font-medium text-gray-700">Difficulty</label>
              <select id="task-difficulty" className="input-field capitalize" value={form.difficulty} onChange={(event) => updateForm('difficulty', event.target.value as TaskDifficulty)}>
                {difficulties.map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="estimated-hours" className="mb-1 block text-sm font-medium text-gray-700">Estimated hours</label>
              <input id="estimated-hours" type="number" min="0" step="0.5" className="input-field" value={form.estimatedHours} onChange={(event) => updateForm('estimatedHours', event.target.value)} />
            </div>
            <div>
              <label htmlFor="grade-weight" className="mb-1 block text-sm font-medium text-gray-700">Grade weight (%)</label>
              <input id="grade-weight" type="number" min="0" max="100" step="0.1" className="input-field" value={form.gradeWeight} onChange={(event) => updateForm('gradeWeight', event.target.value)} />
            </div>
          </div>

          {task && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="task-status" className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                <select id="task-status" className="input-field capitalize" value={form.status} onChange={(event) => updateForm('status', event.target.value as TaskStatus)}>
                  {editableStatuses.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="task-progress" className="mb-1 block text-sm font-medium text-gray-700">Progress (%)</label>
                <input id="task-progress" type="number" min="0" max="100" className="input-field" disabled={form.status === 'completed'} value={form.status === 'completed' ? '100' : form.progressPercentage} onChange={(event) => updateForm('progressPercentage', event.target.value)} />
              </div>
            </div>
          )}

          <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary-600" checked={form.isGroupWork} onChange={(event) => updateForm('isGroupWork', event.target.checked)} />
            This is group work
          </label>

          <div className="flex justify-end gap-3 border-t pt-5">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn-primary disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting}>
              {submitting ? 'Saving…' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskForm;
