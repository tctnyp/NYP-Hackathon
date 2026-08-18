import { FormEvent, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { taskExtractionsApi } from '../services/api';
import type { TaskExtractionData, TaskExtractionFields, TaskExtractionRequest } from '../services/api';
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

type ModifiedFields = Partial<Record<keyof FormState, boolean>>;
type UploadPayload = Pick<TaskExtractionRequest, 'file_name' | 'media_type' | 'document_base64'>;

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
const acceptedMediaTypes = new Set(['image/jpeg', 'image/png', 'application/pdf', 'image/tiff']);
const maximumFileSize = 4 * 1024 * 1024;
const fileAccept = '.jpg,.jpeg,.png,.pdf,.tif,.tiff,image/jpeg,image/png,application/pdf,image/tiff';

const extractionFieldLabels: Record<keyof TaskExtractionFields, string> = {
  title: 'Title',
  description: 'Description',
  task_type: 'Type',
  deadline_local: 'Deadline',
  estimated_hours: 'Estimated hours',
  grade_weight: 'Grade weight',
  is_group_work: 'Group work',
  module_hint: 'Module hint',
};

function toDateTimeLocal(value?: string) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function extractionDateTimeLocal(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : '';
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
}

function normalizeModuleCode(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeModuleName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function uniquelyMatchedModule(modules: Module[], hint: string) {
  const normalizedCodeHint = normalizeModuleCode(hint);
  if (normalizedCodeHint) {
    const codeMatches = modules.filter(
      (module) => normalizeModuleCode(module.module_code) === normalizedCodeHint,
    );
    if (codeMatches.length === 1) return codeMatches[0];
  }

  const normalizedNameHint = normalizeModuleName(hint);
  if (normalizedNameHint) {
    const nameMatches = modules.filter(
      (module) => normalizeModuleName(module.module_name) === normalizedNameHint,
    );
    if (nameMatches.length === 1) return nameMatches[0];
  }

  return undefined;
}

function formatSuggestionValue(value: string | number | boolean) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatConfidence(confidence: number) {
  const boundedConfidence = Math.min(100, Math.max(0, confidence));
  return `${Math.round(boundedConfidence)}% confidence`;
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
  const [modifiedFields, setModifiedFields] = useState<ModifiedFields>({});
  const [upload, setUpload] = useState<UploadPayload | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<TaskExtractionData | null>(null);
  const [extractionError, setExtractionError] = useState('');
  const [extractionStatus, setExtractionStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setModifiedFields((current) => ({ ...current, [field]: true }));
    setForm((current) => ({ ...current, [field]: value }));
  };

  const clearUpload = () => {
    setUpload(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    clearUpload();
    setExtraction(null);
    onClose();
  };

  const handleFileChange = async (file: File | undefined) => {
    clearUpload();
    setExtraction(null);
    setExtractionError('');
    setExtractionStatus('');

    if (!file) return;
    if (!acceptedMediaTypes.has(file.type)) {
      setExtractionError('Choose a JPG, JPEG, PNG, PDF, or TIFF file.');
      return;
    }
    if (file.size > maximumFileSize) {
      setExtractionError('The assignment file must be 4 MiB or smaller.');
      return;
    }

    try {
      setReadingFile(true);
      setExtractionStatus('Reading assignment file…');
      const documentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      setUpload({
        file_name: file.name,
        media_type: file.type,
        document_base64: documentBase64,
      });
      setExtractionStatus(`${file.name} is ready. Select Extract suggestions to continue.`);
    } catch {
      clearUpload();
      setExtractionError('Unable to read the assignment file. Choose it again and retry.');
      setExtractionStatus('');
    } finally {
      setReadingFile(false);
    }
  };

  const extractSuggestions = async () => {
    if (!upload || extracting) return;

    const request: TaskExtractionRequest = {
      ...upload,
      locale: navigator.language || 'en',
    };

    setExtracting(true);
    setExtraction(null);
    setExtractionError('');
    setExtractionStatus('Extracting suggestions…');
    clearUpload();

    try {
      const response = await taskExtractionsApi.extract(request);
      setExtraction(response.data.data);
      setExtractionStatus('Suggestions are ready for review. Nothing has been saved or applied.');
    } catch {
      setExtractionError('Unable to extract suggestions. Choose the file again and retry.');
      setExtractionStatus('');
    } finally {
      setExtracting(false);
    }
  };

  const applySuggestions = () => {
    if (!extraction) return;

    const { fields } = extraction;
    setForm((current) => {
      const next = { ...current };

      if (!modifiedFields.title && current.title === '' && fields.title?.value) {
        next.title = fields.title.value;
      }
      if (!modifiedFields.description && current.description === '' && fields.description?.value) {
        next.description = fields.description.value;
      }
      if (
        !modifiedFields.taskType
        && current.taskType === 'assignment'
        && fields.task_type
        && taskTypes.includes(fields.task_type.value)
      ) {
        next.taskType = fields.task_type.value;
      }
      if (!modifiedFields.deadline && current.deadline === '' && fields.deadline_local?.value) {
        const deadline = extractionDateTimeLocal(fields.deadline_local.value);
        if (deadline) next.deadline = deadline;
      }
      if (
        !modifiedFields.estimatedHours
        && current.estimatedHours === ''
        && fields.estimated_hours
        && Number.isFinite(fields.estimated_hours.value)
      ) {
        next.estimatedHours = String(fields.estimated_hours.value);
      }
      if (
        !modifiedFields.gradeWeight
        && current.gradeWeight === ''
        && fields.grade_weight
        && Number.isFinite(fields.grade_weight.value)
      ) {
        next.gradeWeight = String(fields.grade_weight.value);
      }
      if (
        !modifiedFields.isGroupWork
        && current.isGroupWork === false
        && fields.is_group_work
      ) {
        next.isGroupWork = fields.is_group_work.value;
      }
      if (!modifiedFields.moduleId && current.moduleId === '' && fields.module_hint?.value) {
        const matchedModule = uniquelyMatchedModule(modules, fields.module_hint.value);
        if (matchedModule) next.moduleId = matchedModule.module_id;
      }

      return next;
    });

    setExtraction(null);
    setExtractionStatus('Eligible suggestions were applied. Review the task, then select Create Task to save it.');
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

  const suggestionEntries = extraction
    ? (Object.entries(extraction.fields) as Array<[
      keyof TaskExtractionFields,
      TaskExtractionFields[keyof TaskExtractionFields],
    ]>).filter((entry) => entry[1] !== null)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
          <h2 id="task-form-title" className="text-xl font-semibold">
            {task ? 'Edit Task' : 'Create Task'}
          </h2>
          <button type="button" onClick={handleClose} disabled={submitting || extracting || readingFile} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60" aria-label="Close task form">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {!task && (
            <section className="space-y-4 rounded-lg border border-primary-200 bg-primary-50 p-4" aria-labelledby="assignment-import-title">
              <div>
                <h3 id="assignment-import-title" className="font-semibold text-gray-900">Import an assignment</h3>
                <p id="assignment-file-help" className="mt-1 text-sm text-gray-700">
                  Choose one JPG, JPEG, PNG, PDF, or TIFF file up to 4 MiB. The file is sent only after you select Extract suggestions.
                </p>
              </div>

              <div>
                <label htmlFor="assignment-file" className="mb-1 block text-sm font-medium text-gray-700">Assignment file</label>
                <input
                  ref={fileInputRef}
                  id="assignment-file"
                  type="file"
                  accept={fileAccept}
                  disabled={readingFile || extracting}
                  aria-describedby="assignment-file-help extraction-status"
                  className="block w-full rounded-lg border border-gray-300 bg-white text-sm text-gray-700 file:mr-4 file:border-0 file:bg-primary-100 file:px-4 file:py-2 file:font-medium file:text-primary-800 hover:file:bg-primary-200 disabled:cursor-not-allowed disabled:opacity-60"
                  onChange={(event) => void handleFileChange(event.target.files?.[0])}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!upload || readingFile || extracting}
                  onClick={() => void extractSuggestions()}
                >
                  {extracting ? 'Extracting…' : 'Extract suggestions'}
                </button>
                <p id="extraction-status" className="text-sm text-gray-700" role="status" aria-live="polite">
                  {extractionStatus}
                </p>
              </div>

              {extractionError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {extractionError}
                </p>
              )}

              {extraction && (
                <div className="space-y-3 rounded-lg border border-gray-300 bg-white p-4" aria-labelledby="suggestion-review-title">
                  <div>
                    <h4 id="suggestion-review-title" className="font-semibold text-gray-900">Review suggestions</h4>
                    <p className="text-sm text-gray-600">
                      {extraction.document.pages} {extraction.document.pages === 1 ? 'page' : 'pages'} processed. Suggestions do not change the form until you apply them.
                    </p>
                  </div>

                  <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                    {suggestionEntries.length > 0 ? (
                      <dl className="space-y-3">
                        {suggestionEntries.map(([field, suggestion]) => suggestion && (
                          <div key={field} className="border-b border-gray-200 pb-3 last:border-0 last:pb-0">
                            <dt className="text-sm font-medium text-gray-900">{extractionFieldLabels[field]}</dt>
                            <dd className="break-words text-sm text-gray-700">{formatSuggestionValue(suggestion.value)}</dd>
                            <dd className="text-xs text-gray-500">{formatConfidence(suggestion.confidence)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-gray-700">No field suggestions were found.</p>
                    )}

                    {extraction.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                        <h5 className="text-sm font-semibold">Warnings</h5>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                          {extraction.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  <button type="button" className="btn-secondary" onClick={applySuggestions}>
                    Apply suggestions
                  </button>
                </div>
              )}
            </section>
          )}

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
            <button type="button" className="btn-secondary" onClick={handleClose} disabled={submitting || extracting || readingFile}>Cancel</button>
            <button type="submit" className="btn-primary disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting || extracting || readingFile}>
              {submitting ? 'Saving…' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskForm;
