import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ListTodo,
  LoaderCircle,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../contexts/AccountContext';
import { useAuth } from '../contexts/AuthContext';

export const OPEN_STUDENT_WALKTHROUGH_EVENT = 'academic-tasks:open-walkthrough';
export const ONBOARDING_VERSION = 1;

export function openStudentWalkthrough() {
  window.dispatchEvent(new Event(OPEN_STUDENT_WALKTHROUGH_EVENT));
}

const steps = [
  {
    eyebrow: 'Welcome',
    title: 'Your study plan, all in one place',
    description: 'Academic Tasks helps you see what matters now, plan what is next, and keep group work moving.',
    icon: Sparkles,
    accent: 'onboarding-blue',
    points: ['See today’s priorities', 'Track progress without guesswork', 'Use it on desktop or your phone'],
  },
  {
    eyebrow: 'Step 1',
    title: 'Start by adding what is due',
    description: 'Add assignments, exams, and projects with a deadline. The app will help bring urgent work to the top.',
    icon: ListTodo,
    accent: 'onboarding-green',
    points: ['Open My tasks', 'Add the deadline and module', 'Tick it off when you finish'],
  },
  {
    eyebrow: 'Step 2',
    title: 'Keep each subject organized',
    description: 'Create modules for your subjects, focus with the study timer, and use Calendar to see deadlines together.',
    icon: BookOpen,
    accent: 'onboarding-purple',
    points: ['Group tasks by module', 'Run focused study sessions', 'Check your week in Calendar'],
  },
  {
    eyebrow: 'Step 3',
    title: 'Work together when you need to',
    description: 'Create a private group, invite classmates, and make it clear who is responsible for each task.',
    icon: UsersRound,
    accent: 'onboarding-orange',
    points: ['Invited classmates choose whether to join', 'Assign group tasks to one person', 'Everyone sees the same progress'],
  },
] as const;

function StudentWalkthrough() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, loading, completeOnboarding } = useAccount();
  const [open, setOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingDestination, setPendingDestination] = useState('');
  const pendingDestinationRef = useRef('');
  pendingDestinationRef.current = pendingDestination;
  const dialogRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  savingRef.current = saving;
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const openedForUserRef = useRef('');

  const preferences = profile.preferences;
  const shouldShowForFirstLogin = preferences?.onboarding_required === true
    && (preferences.onboarding_version || 0) < ONBOARDING_VERSION;
  const currentStep = steps[step];
  const isLastStep = step === steps.length - 1;
  const Icon = currentStep.icon;

  useEffect(() => {
    if (!user || loading || !shouldShowForFirstLogin || openedForUserRef.current === user.sub) return;
    openedForUserRef.current = user.sub;
    previousFocusRef.current = document.activeElement as HTMLElement;
    setManualOpen(false);
    setStep(0);
    setError('');
    setPendingDestination('');
    setOpen(true);
  }, [loading, shouldShowForFirstLogin, user]);

  useEffect(() => {
    const reopen = () => {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setManualOpen(true);
      setStep(0);
      setError('');
      setPendingDestination('');
      setOpen(true);
    };
    window.addEventListener(OPEN_STUDENT_WALKTHROUGH_EVENT, reopen);
    return () => window.removeEventListener(OPEN_STUDENT_WALKTHROUGH_EVENT, reopen);
  }, []);

  const finish = async (destination?: string) => {
    setSaving(true);
    setError('');
    setPendingDestination(destination || '');
    try {
      if (!manualOpen && shouldShowForFirstLogin) await completeOnboarding(ONBOARDING_VERSION);
      setOpen(false);
      if (destination) navigate(destination);
    } catch (completionError) {
      console.error('Unable to complete walkthrough:', completionError);
      setError('We could not save your choice. You can continue now and try the walkthrough again later.');
    } finally {
      setSaving(false);
    }
  };

  const continueWithoutSaving = () => {
    setOpen(false);
    if (pendingDestinationRef.current) navigate(pendingDestinationRef.current);
  };

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modalRoot = dialog?.parentElement;
    const backgroundElements = modalRoot?.parentElement
      ? Array.from(modalRoot.parentElement.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modalRoot)
      : [];
    const backgroundState = backgroundElements.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    backgroundElements.forEach((element) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });
    window.setTimeout(() => dialog?.querySelector<HTMLElement>('[data-walkthrough-focus]')?.focus(), 0);

    const focusableSelector = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (savingRef.current) continueWithoutSaving();
        else void finish();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      backgroundState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  const progressLabel = useMemo(() => `Step ${step + 1} of ${steps.length}`, [step]);
  if (!open) return null;

  return (
    <div className="onboarding-backdrop" role="presentation">
      <div ref={dialogRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
        <div className="onboarding-topbar">
          <div className="onboarding-brand"><img src="/icons/app-icon.svg" alt="" /><span>Academic Tasks</span></div>
          <button type="button" className="onboarding-skip" onClick={() => saving ? continueWithoutSaving() : void finish()}>{saving ? 'Continue without saving' : manualOpen ? <><X size={16} /> Close</> : 'Skip tour'}</button>
        </div>

        <div className="onboarding-body">
          <div className={`onboarding-visual ${currentStep.accent}`} aria-hidden="true">
            <div className="onboarding-orbit onboarding-orbit-one" />
            <div className="onboarding-orbit onboarding-orbit-two" />
            <span className="onboarding-main-icon"><Icon size={42} strokeWidth={1.8} /></span>
            {step === 1 && <span className="onboarding-float-card onboarding-float-one"><CheckCircle2 size={18} /> Submit report</span>}
            {step === 2 && <><span className="onboarding-float-card onboarding-float-one"><CalendarDays size={18} /> This week</span><span className="onboarding-float-card onboarding-float-two">25:00 focus</span></>}
            {step === 3 && <span className="onboarding-float-card onboarding-float-one"><UsersRound size={18} /> Project team</span>}
          </div>

          <div className="onboarding-copy" aria-live="polite">
            <p className="onboarding-eyebrow">{currentStep.eyebrow}</p>
            <h2 id="onboarding-title" tabIndex={-1} data-walkthrough-focus>{currentStep.title}</h2>
            <p id="onboarding-description" className="onboarding-description">{currentStep.description}</p>
            <ul className="onboarding-points">
              {currentStep.points.map((point) => <li key={point}><span><Check size={14} /></span>{point}</li>)}
            </ul>
            {error && <div className="onboarding-error" role="alert"><span>{error}</span><button type="button" onClick={continueWithoutSaving}>Continue anyway</button></div>}
          </div>
        </div>

        <div className="onboarding-footer">
          <div className="onboarding-progress" aria-label={progressLabel}>
            <span>{progressLabel}</span>
            <div aria-hidden="true">{steps.map((item, index) => <span key={item.title} className={index === step ? 'onboarding-dot-active' : index < step ? 'onboarding-dot-complete' : ''} />)}</div>
          </div>
          <div className="onboarding-actions">
            {step > 0 && <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setError(''); setStep((current) => current - 1); }}><ArrowLeft size={17} /> Back</button>}
            {isLastStep ? (
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void finish('/tasks?create=1')}>{saving ? <><LoaderCircle className="animate-spin" size={17} /> Saving…</> : <><ListTodo size={17} /> Add my first task</>}</button>
            ) : (
              <button type="button" className="btn-primary" disabled={saving} onClick={() => { setError(''); setStep((current) => current + 1); }}>Next <ArrowRight size={17} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default StudentWalkthrough;
