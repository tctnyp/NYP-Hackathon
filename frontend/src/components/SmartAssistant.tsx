import { useState } from 'react';
import { AlertCircle, CalendarRange, ListChecks, LoaderCircle, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { smartAssistantApi, type SmartAiTool } from '../services/api';

function errorMessage(cause: unknown) {
  if (typeof cause === 'object' && cause !== null && 'response' in cause) {
    const response = (cause as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return 'This AI tool is unavailable right now. Please try again.';
}

const tools: Array<{
  id: SmartAiTool;
  title: string;
  description: string;
  action: string;
  icon: typeof ListChecks;
}> = [
  {
    id: 'prioritize',
    title: 'Prioritize my workload',
    description: 'Rank incomplete tasks using deadlines, progress, priority, and estimated effort.',
    action: 'Build priority list',
    icon: ListChecks,
  },
  {
    id: 'today_plan',
    title: 'Plan my study day',
    description: 'Create a realistic sequence of focused work blocks for the most important tasks.',
    action: 'Create today plan',
    icon: CalendarRange,
  },
  {
    id: 'deadline_risks',
    title: 'Check deadline risks',
    description: 'Identify tasks that may slip and suggest the smallest useful next action for each.',
    action: 'Review risks',
    icon: TriangleAlert,
  },
];

export default function SmartAssistant() {
  const [activeTool, setActiveTool] = useState<SmartAiTool | null>(null);
  const [reply, setReply] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [requestError, setRequestError] = useState('');

  const runTool = async (tool: SmartAiTool) => {
    if (activeTool) return;
    setActiveTool(tool);
    setReply('');
    setRequestError('');
    try {
      const response = await smartAssistantApi.run({ tool, include_context: includeContext });
      setReply(response.data.data.reply);
    } catch (cause) {
      setRequestError(errorMessage(cause));
    } finally {
      setActiveTool(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="page-header">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Gemini-powered tools</p>
          <h1 className="page-title">Smart AI tools</h1>
          <p className="page-subtitle">Choose a focused tool to turn your current workload into useful next steps.</p>
        </div>
      </header>

      <section className="section-card space-y-5" aria-labelledby="smart-ai-tools-heading">
        <div>
          <h2 id="smart-ai-tools-heading" className="text-lg font-semibold">Choose a tool</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">These are purpose-built planning actions, not an AI chat.</p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4" style={{ borderColor: 'var(--app-border)' }}>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-blue-600"
            checked={includeContext}
            onChange={(event) => setIncludeContext(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">Use my incomplete task summaries</span>
            <span className="mt-1 block text-xs leading-5 text-gray-500">Task titles, modules, deadlines, status, priority, estimates, and progress are sent to Google Gemini. Descriptions and account details are excluded.</span>
          </span>
        </label>

        {!includeContext && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <AlertCircle className="mt-0.5 shrink-0" size={17} /> Enable task summaries for recommendations based on your workload.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const loading = activeTool === tool.id;
            return (
              <article key={tool.id} className="flex min-h-64 flex-col rounded-2xl border p-5" style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface-raised)' }}>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-600"><Icon size={23} /></div>
                <h3 className="mt-4 font-semibold">{tool.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-gray-500">{tool.description}</p>
                <button type="button" className="btn-primary mt-5 inline-flex items-center justify-center gap-2" disabled={Boolean(activeTool) || !includeContext} onClick={() => void runTool(tool.id)}>
                  {loading ? <><LoaderCircle className="animate-spin" size={17} /> Working…</> : tool.action}
                </button>
              </article>
            );
          })}
        </div>

        {requestError && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertCircle className="mt-0.5 shrink-0" size={17} /> {requestError}
          </div>
        )}

        {reply && (
          <article className="rounded-2xl bg-primary-50 p-5" aria-live="polite">
            <div className="mb-3 flex items-center gap-2 font-semibold text-primary-800"><Sparkles size={18} /> Tool result</div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-gray-700">{reply}</div>
          </article>
        )}
      </section>

      <section className="section-card flex items-start gap-3">
        <ShieldCheck className="mt-0.5 shrink-0 text-green-600" size={20} />
        <div><h2 className="text-sm font-semibold">You stay in control</h2><p className="mt-1 text-xs leading-5 text-gray-500">AI tools provide suggestions only. They cannot create, edit, submit, or complete tasks.</p></div>
      </section>
    </div>
  );
}
