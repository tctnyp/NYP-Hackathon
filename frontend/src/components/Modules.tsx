import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, BookOpen, Plus, X } from 'lucide-react';
import { modulesApi } from '../services/api';
import type { Module } from '../types/api';

const moduleColors = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Pink', value: '#EC4899' },
];

const initialForm = { code: '', name: '', color: moduleColors[0].value };

function Modules() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);

  const loadModules = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const response = await modulesApi.getAll();
      setModules(response.data.data.modules || []);
    } catch (error) {
      console.error('Error loading modules:', error);
      setLoadError('We couldn’t load your modules. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadModules();
  }, []);

  useEffect(() => {
    if (!formOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setFormOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [formOpen, saving]);

  const openForm = () => {
    setFormError('');
    setFormOpen(true);
  };

  const createModule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const moduleCode = form.code.trim().toUpperCase();
    const moduleName = form.name.trim();

    if (!moduleCode || !moduleName) {
      setFormError('Enter both a module code and module name.');
      return;
    }

    try {
      setSaving(true);
      setFormError('');
      const response = await modulesApi.create({
        module_code: moduleCode,
        module_name: moduleName,
        color: form.color,
      });
      const createdModule = response.data.data.module;
      setModules((current) => [
        { ...createdModule, task_count: 0, active_task_count: 0 },
        ...current.filter((module) => module.module_id !== createdModule.module_id),
      ]);
      setForm(initialForm);
      setFormOpen(false);
      setLoadError('');
    } catch (error) {
      console.error('Error creating module:', error);
      setFormError('We couldn’t create that module. Check the details and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Modules</h1>
        <button type="button" className="btn-primary flex items-center gap-2" onClick={openForm}>
          <Plus size={20} />
          Add Module
        </button>
      </div>

      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span className="flex items-center gap-2"><AlertCircle size={18} />{loadError}</span>
          <button type="button" className="font-semibold underline" onClick={() => void loadModules()}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : modules.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center">
          <BookOpen className="mx-auto mb-4 text-gray-400" size={48} />
          <h2 className="mb-2 text-xl font-semibold text-gray-700">No Modules Yet</h2>
          <p className="mb-5 text-gray-500">Add your first module to start organizing tasks.</p>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openForm}>
            <Plus size={18} /> Add your first module
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <div key={module.module_id} className="rounded-lg border-2 bg-white p-6 transition hover:shadow-lg" style={{ borderColor: module.color }}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg font-bold text-white" style={{ backgroundColor: module.color }}>
                  {module.module_code.substring(0, 2).toUpperCase()}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{module.active_task_count || 0}</p>
                  <p className="text-xs text-gray-500">active</p>
                </div>
              </div>
              <h3 className="text-lg font-semibold">{module.module_code}</h3>
              <p className="mt-1 text-sm text-gray-600">{module.module_name}</p>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="module-form-title"
          onMouseDown={(event) => event.target === event.currentTarget && !saving && setFormOpen(false)}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 id="module-form-title" className="text-xl font-semibold">Add a module</h2>
              <button type="button" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-60" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close module form">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={createModule} className="space-y-5 p-6">
              {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{formError}</p>}
              <div>
                <label htmlFor="module-code" className="mb-1 block text-sm font-medium text-gray-700">Module code</label>
                <input id="module-code" autoFocus required maxLength={30} className="input-field uppercase" placeholder="e.g. CS101" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
              </div>
              <div>
                <label htmlFor="module-name" className="mb-1 block text-sm font-medium text-gray-700">Module name</label>
                <input id="module-name" required maxLength={120} className="input-field" placeholder="e.g. Introduction to Computing" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-gray-700">Color</legend>
                <div className="flex flex-wrap gap-3">
                  {moduleColors.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`h-10 w-10 rounded-full border-2 transition ${form.color === color.value ? 'scale-110 border-gray-900 ring-2 ring-gray-300' : 'border-white'}`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setForm((current) => ({ ...current, color: color.value }))}
                      aria-label={`${color.name}${form.color === color.value ? ', selected' : ''}`}
                      aria-pressed={form.color === color.value}
                    />
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-3 border-t pt-4">
                <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary min-w-28 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving}>{saving ? 'Adding…' : 'Add module'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Modules;
