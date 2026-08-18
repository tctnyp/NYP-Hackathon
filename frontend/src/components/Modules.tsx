import { FormEvent, useEffect, useState } from 'react';
import { modulesApi } from '../services/api';
import { AlertCircle, BookOpen, Play, Plus, RefreshCw, X } from 'lucide-react';
import type { Module } from '../types/api';
import StudyTimer, { type FocusModuleRequest } from './StudyTimer';

const moduleColors = [
  { name: 'Blue', value: '#2563eb' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Teal', value: '#0891b2' },
  { name: 'Slate', value: '#475569' },
];

function Modules() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusModuleRequest>();
  const [form, setForm] = useState({ code: '', name: '', color: moduleColors[0].value });

  const loadModules = async () => {
    try {
      setLoading(true);
      setPageError('');
      const response = await modulesApi.getAll();
      setModules(response.data.data.modules || []);
    } catch (loadError) {
      console.error('Error loading modules:', loadError);
      setPageError('We couldn’t load your modules. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadModules(); }, []);
  useEffect(() => {
    if (!formOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setFormOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [formOpen, saving]);

  const openForm = () => { setFormError(''); setFormOpen(true); };
  const chooseFocusModule = (moduleId: string) => {
    setFocusRequest({ moduleId, requestId: Date.now() });
    window.requestAnimationFrame(() => document.getElementById('study-timer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const createModule = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setSaving(true);
      setFormError('');
      const response = await modulesApi.create({
        module_code: form.code.trim().toUpperCase(),
        module_name: form.name.trim(),
        color: form.color,
      });
      setFormOpen(false);
      setForm({ code: '', name: '', color: moduleColors[0].value });
      await loadModules();
      setFocusRequest({ moduleId: response.data.data.module.module_id, requestId: Date.now() });
    } catch (saveError) {
      console.error('Error creating module:', saveError);
      setFormError('We couldn’t create that module. Check the details and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow"><BookOpen size={14} /> Subjects & courses</p>
          <h1 className="page-title">Modules</h1>
          <p className="page-subtitle">Choose a subject, start a focus session, and build your study momentum.</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={openForm}><Plus size={18} /> Add module</button>
      </header>

      {pageError && (
        <div className="alert-error" role="alert">
          <span className="flex items-center gap-2"><AlertCircle size={18} /> {pageError}</span>
          <button type="button" onClick={() => void loadModules()} className="inline-flex items-center gap-1.5 font-semibold"><RefreshCw size={15} /> Retry</button>
        </div>
      )}

      {loading ? (
        <><div className="skeleton h-[30rem] rounded-3xl" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-52 rounded-3xl" />)}</div></>
      ) : pageError && modules.length === 0 ? (
        <div className="section-card empty-state min-h-80"><div className="empty-icon"><RefreshCw size={25} /></div><h2>Modules unavailable</h2><p>We couldn’t reach your module list. Your data is safe—try again when you’re ready.</p><button type="button" className="btn-secondary" onClick={() => void loadModules()}>Try again</button></div>
      ) : modules.length === 0 ? (
        <div className="section-card empty-state min-h-96"><div className="empty-icon"><BookOpen size={26} /></div><h2>Create a module to start focusing</h2><p>Your study timer is organized by module, so every session contributes to the right subject.</p><button type="button" onClick={openForm} className="btn-primary inline-flex items-center gap-2"><Plus size={17} /> Add your first module</button></div>
      ) : (
        <>
          <StudyTimer modules={modules} focusRequest={focusRequest} />
          <section aria-labelledby="module-list-heading">
            <div className="mb-4 flex items-end justify-between gap-4"><div><h2 id="module-list-heading" className="section-title">Your modules</h2><p className="mt-1 text-sm text-gray-500">Jump straight into a focused study session.</p></div><span className="text-xs font-semibold text-gray-400">{modules.length} {modules.length === 1 ? 'module' : 'modules'}</span></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {modules.map((module) => (
                <article key={module.module_id} className="module-card">
                  <div className="mb-6 flex items-start justify-between">
                    <div className="module-monogram" style={{ backgroundColor: module.color }}>{module.module_code.substring(0, 2).toUpperCase()}</div>
                    <div className="text-right"><p className="text-2xl font-semibold tracking-tight">{module.active_task_count || 0}</p><p className="text-xs font-medium text-gray-500">active tasks</p></div>
                  </div>
                  <div className="mb-3 h-1 w-10 rounded-full" style={{ backgroundColor: module.color }} />
                  <h3 className="module-code-title text-lg font-semibold tracking-tight">{module.module_code}</h3>
                  <p className="mt-1 line-clamp-2 min-h-12 text-sm leading-6 text-gray-500">{module.module_name}</p>
                  <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
                    <span className="text-xs font-medium text-gray-400">{module.task_count || 0} total tasks</span>
                    <button type="button" className="module-study-button" onClick={() => chooseFocusModule(module.module_id)}><Play size={14} fill="currentColor" /> Study</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {formOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="module-form-title" onMouseDown={(event) => event.target === event.currentTarget && !saving && setFormOpen(false)}>
          <div className="modal-panel max-w-lg">
            <div className="flex items-start justify-between border-b px-6 py-5" style={{ borderColor: 'var(--app-border)' }}><div><p className="eyebrow mb-1">New collection</p><h2 id="module-form-title" className="text-xl font-semibold">Add a module</h2></div><button type="button" className="icon-button -mr-2" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close"><X size={20} /></button></div>
            <form onSubmit={createModule}>
              <div className="space-y-5 p-6">
                {formError && <div className="alert-error" role="alert"><span className="flex items-center gap-2"><AlertCircle size={18} /> {formError}</span></div>}
                <div><label htmlFor="module-code" className="field-label">Module code</label><input id="module-code" autoFocus required maxLength={30} className="input-field uppercase" placeholder="e.g. CS101" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></div>
                <div><label htmlFor="module-name" className="field-label">Module name</label><input id="module-name" required maxLength={120} className="input-field" placeholder="e.g. Introduction to Computing" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
                <fieldset><legend className="field-label">Color</legend><div className="flex flex-wrap gap-3">{moduleColors.map((color) => <button key={color.value} type="button" className={`color-choice ${form.color === color.value ? 'color-choice-active' : ''}`} style={{ backgroundColor: color.value }} onClick={() => setForm({ ...form, color: color.value })} aria-label={`${color.name}${form.color === color.value ? ', selected' : ''}`} aria-pressed={form.color === color.value} />)}</div></fieldset>
              </div>
              <div className="flex justify-end gap-3 border-t px-6 py-4" style={{ borderColor: 'var(--app-border)' }}><button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="btn-primary min-w-28" disabled={saving}>{saving ? 'Adding…' : 'Add module'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Modules;
