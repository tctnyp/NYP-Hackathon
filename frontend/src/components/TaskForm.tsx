import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, X } from 'lucide-react';
import type { Module, Task, TaskDifficulty, TaskStatus, TaskType } from '../types/api';

interface TaskFormProps { task?: Task; modules: Module[]; modulesError?: string; submitting: boolean; error?: string; onClose: () => void; onSubmit: (data: Partial<Task>) => Promise<void>; }
interface FormState { title: string; description: string; taskType: TaskType; deadline: string; moduleId: string; estimatedHours: string; gradeWeight: string; difficulty: TaskDifficulty; isGroupWork: boolean; status: TaskStatus; progressPercentage: string; }

const taskTypes: TaskType[] = ['assignment', 'test', 'exam', 'project', 'presentation', 'report', 'competition', 'other'];
const difficulties: TaskDifficulty[] = ['easy', 'medium', 'hard', 'very_hard'];
const editableStatuses: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'overdue'];

function toDateTimeLocal(value?: string) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

function TaskForm({ task, modules, modulesError, submitting, error, onClose, onSubmit }: TaskFormProps) {
  const [form, setForm] = useState<FormState>({ title: task?.title || '', description: task?.description || '', taskType: task?.task_type || 'assignment', deadline: toDateTimeLocal(task?.deadline), moduleId: task?.module_id || '', estimatedHours: task?.estimated_hours?.toString() || '', gradeWeight: task?.grade_weight?.toString() || '', difficulty: task?.difficulty || 'medium', isGroupWork: task?.is_group_work || false, status: task?.status || 'not_started', progressPercentage: task?.progress_percentage?.toString() || '0' });

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, submitting]);

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => setForm((current) => ({ ...current, [field]: value }));
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: Partial<Task> = { title: form.title.trim(), description: form.description.trim() || null, task_type: form.taskType, deadline: new Date(form.deadline).toISOString(), module_id: form.moduleId || null, estimated_hours: form.estimatedHours ? Number(form.estimatedHours) : null, grade_weight: form.gradeWeight ? Number(form.gradeWeight) : null, difficulty: form.difficulty, is_group_work: form.isGroupWork };
    if (task) {
      if (form.status !== task.status) payload.status = form.status;
      payload.progress_percentage = form.status === 'completed' ? 100 : Number(form.progressPercentage);
    }
    await onSubmit(payload);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-panel">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b px-5 py-4 sm:px-7 sm:py-5" style={{ background: 'var(--app-sheet)', borderColor: 'var(--app-border)' }}><div><p className="eyebrow mb-1">{task ? 'Update your plan' : 'Plan your next step'}</p><h2 id="task-form-title" className="text-xl font-semibold tracking-tight">{task ? 'Edit task' : 'Create a task'}</h2></div><button type="button" onClick={onClose} disabled={submitting} className="icon-button -mr-2" aria-label="Close task form"><X size={20} /></button></div>
        <form onSubmit={handleSubmit}>
          <div className="space-y-6 p-5 sm:p-7">
            {error && <div className="alert-error" role="alert" tabIndex={-1}><span className="flex items-center gap-2"><AlertCircle size={18} /> {error}</span></div>}
            <section className="space-y-4" aria-labelledby="task-basics-heading">
              <div><h3 id="task-basics-heading" className="form-section-title">Task details</h3><p className="form-help">Start with what needs doing and when it matters.</p></div>
              <div><label htmlFor="task-title" className="field-label">Title <span aria-hidden="true">*</span></label><input id="task-title" required autoFocus maxLength={200} className="input-field" placeholder="e.g. Submit research proposal" value={form.title} onChange={(event) => updateForm('title', event.target.value)} /></div>
              <div><label htmlFor="task-description" className="field-label">Notes <span className="font-normal text-gray-400">Optional</span></label><textarea id="task-description" rows={3} className="input-field resize-none" placeholder="Add context, links, or a quick checklist…" value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></div>
              <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="task-deadline" className="field-label">Deadline <span aria-hidden="true">*</span></label><input id="task-deadline" type="datetime-local" required className="input-field" value={form.deadline} onChange={(event) => updateForm('deadline', event.target.value)} /></div><div><label htmlFor="task-type" className="field-label">Type</label><select id="task-type" className="input-field capitalize" value={form.taskType} onChange={(event) => updateForm('taskType', event.target.value as TaskType)}>{taskTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></div></div>
              <div><label htmlFor="task-module" className="field-label">Module</label><select id="task-module" className="input-field" value={form.moduleId} onChange={(event) => updateForm('moduleId', event.target.value)}><option value="">No module</option>{modules.map((module) => <option key={module.module_id} value={module.module_id}>{module.module_code} — {module.module_name}</option>)}</select>{modulesError && <p className="mt-1.5 text-xs text-amber-600" role="status">{modulesError}</p>}</div>
            </section>
            {task && <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)' }} aria-labelledby="task-progress-heading"><h3 id="task-progress-heading" className="form-section-title">Progress</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label htmlFor="task-status" className="field-label">Status</label><select id="task-status" className="input-field capitalize" value={form.status} onChange={(event) => updateForm('status', event.target.value as TaskStatus)}>{editableStatuses.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select></div><div><div className="flex justify-between"><label htmlFor="task-progress" className="field-label">Completion</label><span className="text-sm font-semibold text-primary-600">{form.status === 'completed' ? '100' : form.progressPercentage}%</span></div><input id="task-progress" type="range" min="0" max="100" step="5" className="mt-3 w-full accent-blue-600" disabled={form.status === 'completed'} value={form.status === 'completed' ? '100' : form.progressPercentage} onChange={(event) => updateForm('progressPercentage', event.target.value)} /></div></div></section>}
            <details className="form-details" open={Boolean(task?.estimated_hours || task?.grade_weight || task?.is_group_work)}><summary><span><strong>More details</strong><small>Effort, difficulty, and grade impact</small></span><ChevronDown size={18} /></summary><div className="grid gap-4 border-t p-4 sm:grid-cols-2" style={{ borderColor: 'var(--app-border)' }}><div><label htmlFor="task-difficulty" className="field-label">Difficulty</label><select id="task-difficulty" className="input-field capitalize" value={form.difficulty} onChange={(event) => updateForm('difficulty', event.target.value as TaskDifficulty)}>{difficulties.map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty.replace('_', ' ')}</option>)}</select></div><div><label htmlFor="estimated-hours" className="field-label">Estimated hours</label><input id="estimated-hours" type="number" min="0" step="0.5" inputMode="decimal" className="input-field" placeholder="e.g. 3" value={form.estimatedHours} onChange={(event) => updateForm('estimatedHours', event.target.value)} /></div><div><label htmlFor="grade-weight" className="field-label">Grade weight (%)</label><input id="grade-weight" type="number" min="0" max="100" step="0.1" inputMode="decimal" className="input-field" placeholder="e.g. 20" value={form.gradeWeight} onChange={(event) => updateForm('gradeWeight', event.target.value)} /></div><label className="flex min-h-11 cursor-pointer items-center gap-3 self-end rounded-xl border px-3 text-sm font-medium" style={{ borderColor: 'var(--app-border)' }}><input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-blue-600" checked={form.isGroupWork} onChange={(event) => updateForm('isGroupWork', event.target.checked)} /> Group work</label></div></details>
          </div>
          <div className="sticky bottom-0 flex justify-end gap-3 border-t px-5 py-4 sm:px-7" style={{ background: 'var(--app-sheet)', borderColor: 'var(--app-border)' }}><button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="btn-primary min-w-32 disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting}>{submitting ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button></div>
        </form>
      </div>
    </div>
  );
}

export default TaskForm;
