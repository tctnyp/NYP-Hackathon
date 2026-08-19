import { FormEvent, useState } from 'react';
import { AlertCircle, BrainCircuit, LoaderCircle, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { smartAssistantApi } from '../services/api';

function errorMessage(cause: unknown) {
  if (typeof cause === 'object' && cause !== null && 'response' in cause) {
    const response = (cause as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return 'Smart AI is unavailable right now. Please try again.';
}

export default function SmartAssistant() {
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || loading) return;

    setLoading(true);
    setRequestError('');
    try {
      const response = await smartAssistantApi.ask({
        prompt: question,
        include_context: includeContext,
      });
      setReply(response.data.data.reply);
    } catch (cause) {
      setRequestError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    'Prioritize my current tasks and give me a realistic plan for today.',
    'Which deadlines look risky, and what should I start first?',
    'Create a focused study plan for my incomplete work this week.',
  ];

  return (
    <div className="space-y-6">
      <header className="page-header">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> Gemini-powered planning</p>
          <h1 className="page-title">Smart AI</h1>
          <p className="page-subtitle">Turn your workload into a clear, achievable study plan.</p>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="section-card space-y-5" aria-labelledby="smart-ai-prompt-heading">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
              <BrainCircuit size={24} />
            </div>
            <div>
              <h2 id="smart-ai-prompt-heading" className="text-lg font-semibold">What would you like to plan?</h2>
              <p className="mt-1 text-sm leading-6 text-gray-500">Ask for prioritization, a study schedule, or help breaking down difficult work.</p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="field-label" htmlFor="smart-ai-prompt">Your request</label>
              <textarea
                id="smart-ai-prompt"
                className="input-field min-h-36 resize-y"
                maxLength={2000}
                placeholder="e.g. Help me decide what to work on after class today"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <p className="mt-1 text-right text-xs text-gray-400">{prompt.length}/2000</p>
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
                <span className="mt-1 block text-xs leading-5 text-gray-500">Task titles, modules, deadlines, status, priority, estimates, and progress will be sent to Google Gemini with this request. Descriptions and account details are excluded.</span>
              </span>
            </label>

            {requestError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
                <AlertCircle className="mt-0.5 shrink-0" size={17} /> {requestError}
              </div>
            )}

            <button type="submit" className="btn-primary inline-flex items-center justify-center gap-2" disabled={!prompt.trim() || loading}>
              {loading ? <><LoaderCircle className="animate-spin" size={18} /> Thinking…</> : <><Send size={17} /> Ask Smart AI</>}
            </button>
          </form>

          {reply && (
            <article className="rounded-2xl bg-primary-50 p-5" aria-live="polite">
              <div className="mb-3 flex items-center gap-2 font-semibold text-primary-800"><Sparkles size={18} /> Your plan</div>
              <div className="whitespace-pre-wrap text-sm leading-7 text-gray-700">{reply}</div>
            </article>
          )}
        </section>

        <aside className="space-y-4">
          <section className="section-card">
            <h2 className="text-sm font-semibold">Try asking</h2>
            <div className="mt-3 space-y-2">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className="w-full rounded-xl border p-3 text-left text-sm leading-5 transition hover:bg-gray-50" style={{ borderColor: 'var(--app-border)' }} onClick={() => setPrompt(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </section>
          <section className="section-card flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-green-600" size={20} />
            <div><h2 className="text-sm font-semibold">You stay in control</h2><p className="mt-1 text-xs leading-5 text-gray-500">Smart AI provides suggestions only. It cannot create, edit, submit, or complete tasks.</p></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
