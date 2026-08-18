import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, Pause, Play, RotateCcw, Square, TimerReset, TrendingUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Module } from '../types/api';

type TimerStatus = 'idle' | 'running' | 'paused';

interface FocusSegment {
  startedAt: number;
  endedAt: number;
}

interface ActiveTimer {
  moduleId: string;
  status: Exclude<TimerStatus, 'idle'>;
  runningSince: number | null;
  sessionStartedAt: number;
  accumulatedMs: number;
  segments?: FocusSegment[];
}

interface StudySession {
  id: string;
  moduleId: string;
  moduleCode: string;
  moduleName: string;
  moduleColor: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  segments?: FocusSegment[];
}

export interface FocusModuleRequest {
  moduleId: string;
  requestId: number;
}

interface StudyTimerProps {
  modules: Module[];
  focusRequest?: FocusModuleRequest;
}

const MAX_SESSIONS = 500;

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Unable to save focus timer:', error);
  }
}

function removeStored(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error('Unable to clear focus timer:', error);
  }
}

function formatTimer(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, '0')).join(':');
}

function formatStudyTime(milliseconds: number) {
  if (milliseconds <= 0) return '0m';
  if (milliseconds < 60_000) return `${Math.max(1, Math.floor(milliseconds / 1000))}s`;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function todayBounds() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  return { start, end };
}

function overlapMs(startedAt: number, endedAt: number, dayStart: number, dayEnd: number) {
  return Math.max(0, Math.min(endedAt, dayEnd) - Math.max(startedAt, dayStart));
}

function focusedTimeToday(startedAt: number, endedAt: number, durationMs: number, segments?: FocusSegment[]) {
  const { start, end } = todayBounds();
  if (segments) return segments.reduce((total, segment) => total + overlapMs(segment.startedAt, segment.endedAt, start, end), 0);

  // Older persisted sessions did not record running segments. Allocate their focused
  // duration proportionally across their wall-clock span as a safe migration fallback.
  const wallClockMs = Math.max(1, endedAt - startedAt);
  const overlap = overlapMs(startedAt, endedAt, start, end);
  return Math.min(durationMs, Math.round(durationMs * (overlap / wallClockMs)));
}

function StudyTimer({ modules, focusRequest }: StudyTimerProps) {
  const { user } = useAuth();
  const scope = user?.sub || user?.username || 'local';
  const activeKey = `academic-focus:${scope}:active`;
  const sessionsKey = `academic-focus:${scope}:sessions`;
  const [selectedModuleId, setSelectedModuleId] = useState(focusRequest?.moduleId || modules[0]?.module_id || '');
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [accumulatedMs, setAccumulatedMs] = useState(0);
  const [segments, setSegments] = useState<FocusSegment[] | undefined>([]);
  const [now, setNow] = useState(Date.now());
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const initialTitle = useRef(document.title);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const applyActiveTimer = (active: ActiveTimer | null) => {
    if (active && modules.some((module) => module.module_id === active.moduleId)) {
      setSelectedModuleId(active.moduleId);
      setStatus(active.status);
      setRunningSince(active.runningSince);
      setSessionStartedAt(active.sessionStartedAt);
      setAccumulatedMs(active.accumulatedMs);
      setSegments(Array.isArray(active.segments) ? active.segments : undefined);
    } else {
      setStatus('idle');
      setRunningSince(null);
      setSessionStartedAt(null);
      setAccumulatedMs(0);
      setSegments([]);
      setSelectedModuleId((current) => current || modules[0]?.module_id || '');
    }
    setNow(Date.now());
  };

  useEffect(() => {
    const storedSessions = readJson<StudySession[]>(sessionsKey, []);
    setSessions(Array.isArray(storedSessions) ? storedSessions.slice(0, MAX_SESSIONS) : []);
    applyActiveTimer(readJson<ActiveTimer | null>(activeKey, null));
    setHydratedKey(activeKey);
  }, [activeKey, modules, sessionsKey]);

  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === sessionsKey) {
        const latest = event.newValue ? readJson<StudySession[]>(sessionsKey, []) : [];
        setSessions(Array.isArray(latest) ? latest.slice(0, MAX_SESSIONS) : []);
      }
      if (event.key === activeKey) applyActiveTimer(event.newValue ? readJson<ActiveTimer | null>(activeKey, null) : null);
    };
    window.addEventListener('storage', syncAcrossTabs);
    return () => window.removeEventListener('storage', syncAcrossTabs);
  }, [activeKey, modules, sessionsKey]);

  useEffect(() => {
    if (!focusRequest) return;
    if (status === 'idle' && modules.some((module) => module.module_id === focusRequest.moduleId)) setSelectedModuleId(focusRequest.moduleId);
    window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }, [focusRequest, modules, status]);

  useEffect(() => {
    if (hydratedKey !== activeKey) return;
    if (status === 'idle' || !sessionStartedAt) {
      removeStored(activeKey);
      return;
    }
    writeJson(activeKey, { moduleId: selectedModuleId, status, runningSince, sessionStartedAt, accumulatedMs, segments } satisfies ActiveTimer);
  }, [accumulatedMs, activeKey, hydratedKey, runningSince, segments, selectedModuleId, sessionStartedAt, status]);

  useEffect(() => {
    if (status !== 'running') return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [status]);

  const elapsedMs = accumulatedMs + (status === 'running' && runningSince ? Math.max(0, now - runningSince) : 0);
  const selectedModule = modules.find((module) => module.module_id === selectedModuleId) || modules[0];

  useEffect(() => {
    if (status === 'idle') {
      document.title = initialTitle.current;
      return;
    }
    document.title = `${formatTimer(elapsedMs)} · ${selectedModule?.module_code || 'Focus'}`;
    return () => { document.title = initialTitle.current; };
  }, [elapsedMs, selectedModule?.module_code, status]);

  const completedTodayMs = useMemo(() => sessions.reduce((total, session) => total + focusedTimeToday(session.startedAt, session.endedAt, session.durationMs, session.segments), 0), [sessions]);
  const activeSegments = useMemo(() => {
    if (!sessionStartedAt) return undefined;
    if (!segments) return undefined;
    return status === 'running' && runningSince ? [...segments, { startedAt: runningSince, endedAt: now }] : segments;
  }, [now, runningSince, segments, sessionStartedAt, status]);
  const activeTodayMs = sessionStartedAt ? focusedTimeToday(sessionStartedAt, now, elapsedMs, activeSegments) : 0;
  const todayTotalMs = completedTodayMs + activeTodayMs;
  const moduleTotalTodayMs = useMemo(() => sessions
    .filter((session) => session.moduleId === selectedModuleId)
    .reduce((total, session) => total + focusedTimeToday(session.startedAt, session.endedAt, session.durationMs, session.segments), 0), [selectedModuleId, sessions]);

  const start = () => {
    if (!selectedModule) return;
    const timestamp = Date.now();
    const active: ActiveTimer = { moduleId: selectedModule.module_id, status: 'running', runningSince: timestamp, sessionStartedAt: timestamp, accumulatedMs: 0, segments: [] };
    writeJson(activeKey, active);
    setAccumulatedMs(0);
    setSegments([]);
    setSessionStartedAt(timestamp);
    setRunningSince(timestamp);
    setNow(timestamp);
    setStatus('running');
  };

  const pause = () => {
    const timestamp = Date.now();
    const segmentDuration = runningSince ? Math.max(0, timestamp - runningSince) : 0;
    const nextAccumulated = accumulatedMs + segmentDuration;
    const nextSegments = segments && runningSince ? [...segments, { startedAt: runningSince, endedAt: timestamp }] : segments;
    writeJson(activeKey, { moduleId: selectedModuleId, status: 'paused', runningSince: null, sessionStartedAt: sessionStartedAt || timestamp, accumulatedMs: nextAccumulated, segments: nextSegments } satisfies ActiveTimer);
    setAccumulatedMs(nextAccumulated);
    setSegments(nextSegments);
    setRunningSince(null);
    setNow(timestamp);
    setStatus('paused');
  };

  const resume = () => {
    const timestamp = Date.now();
    writeJson(activeKey, { moduleId: selectedModuleId, status: 'running', runningSince: timestamp, sessionStartedAt: sessionStartedAt || timestamp, accumulatedMs, segments } satisfies ActiveTimer);
    setRunningSince(timestamp);
    setNow(timestamp);
    setStatus('running');
  };

  const clearTimerState = () => {
    setStatus('idle');
    setRunningSince(null);
    setSessionStartedAt(null);
    setAccumulatedMs(0);
    setSegments([]);
    setNow(Date.now());
  };

  const finish = () => {
    if (!selectedModule || !sessionStartedAt) return;
    const endedAt = Date.now();
    const currentSegment = status === 'running' && runningSince ? { startedAt: runningSince, endedAt } : null;
    const durationMs = accumulatedMs + (currentSegment ? currentSegment.endedAt - currentSegment.startedAt : 0);
    const completedSegments = segments ? [...segments, ...(currentSegment ? [currentSegment] : [])] : undefined;
    if (durationMs >= 1000) {
      const session: StudySession = { id: `${endedAt}-${Math.random().toString(36).slice(2, 8)}`, moduleId: selectedModule.module_id, moduleCode: selectedModule.module_code, moduleName: selectedModule.module_name, moduleColor: selectedModule.color, startedAt: sessionStartedAt, endedAt, durationMs, segments: completedSegments };
      const latestSessions = readJson<StudySession[]>(sessionsKey, []);
      const merged = [session, ...latestSessions, ...sessions]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, MAX_SESSIONS);
      setSessions(merged);
      writeJson(sessionsKey, merged);
    }
    removeStored(activeKey);
    clearTimerState();
  };

  const discard = () => {
    if (elapsedMs >= 60_000 && !window.confirm('Discard this focus session? The time won’t be added to today’s total.')) return;
    removeStored(activeKey);
    clearTimerState();
  };

  if (!selectedModule) return null;
  const liveStatus = status === 'idle' ? `${selectedModule.module_code} is ready to study.` : status === 'running' ? `Focus session running for ${selectedModule.module_code}.` : `Focus session paused at ${formatTimer(elapsedMs)}.`;

  return (
    <section id="study-timer" className={`focus-studio ${status === 'running' ? 'focus-studio-running' : ''}`} aria-labelledby="focus-timer-heading">
      <div className="focus-main">
        <div className="flex items-start justify-between gap-4">
          <div><p className="eyebrow"><TimerReset size={14} /> Focus room</p><h2 ref={headingRef} tabIndex={-1} id="focus-timer-heading" className="text-xl font-semibold tracking-tight outline-none">Study timer</h2></div>
          <span className={`focus-status focus-status-${status}`}><span />{status === 'idle' ? 'Ready' : status === 'running' ? 'Focusing' : 'Paused'}</span>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{liveStatus}</p>
        </div>

        <label className="mt-6 block"><span className="field-label">Studying</span><select className="focus-module-select" value={selectedModule.module_id} disabled={status !== 'idle'} onChange={(event) => setSelectedModuleId(event.target.value)}>{modules.map((module) => <option key={module.module_id} value={module.module_id}>{module.module_code} — {module.module_name}</option>)}</select></label>

        <div className="focus-clock-wrap" style={{ '--module-color': selectedModule.color } as React.CSSProperties}>
          <div className="focus-clock" aria-live="off"><span className="focus-clock-label">{status === 'idle' ? 'Ready when you are' : selectedModule.module_code}</span><time className="focus-time" dateTime={`PT${Math.floor(elapsedMs / 1000)}S`}>{formatTimer(elapsedMs)}</time><span className="focus-clock-caption">hours · minutes · seconds</span></div>
        </div>

        <div className="focus-controls">
          {status === 'idle' && <button type="button" className="focus-control-primary" onClick={start}><Play size={20} fill="currentColor" /> Start focus</button>}
          {status === 'running' && <button type="button" className="focus-control-primary" onClick={pause}><Pause size={20} fill="currentColor" /> Pause</button>}
          {status === 'paused' && <button type="button" className="focus-control-primary" onClick={resume}><Play size={20} fill="currentColor" /> Resume</button>}
          {status !== 'idle' && <button type="button" className="focus-control-finish" onClick={finish}><Square size={18} fill="currentColor" /> Finish</button>}
          {status !== 'idle' && <button type="button" className="icon-button" onClick={discard} aria-label="Discard focus session" title="Discard session"><RotateCcw size={18} /></button>}
        </div>
      </div>

      <aside className="focus-summary" aria-label="Today’s study summary">
        <div className="focus-total"><div className="focus-total-icon"><TrendingUp size={21} /></div><div><p>Today’s focus</p><strong>{formatStudyTime(todayTotalMs)}</strong><span>{sessions.filter((session) => focusedTimeToday(session.startedAt, session.endedAt, session.durationMs, session.segments) > 0).length} completed today</span></div></div>
        <div className="focus-module-stat"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedModule.color }} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{selectedModule.module_code}</p><span>Completed today</span></div><strong>{formatStudyTime(moduleTotalTodayMs)}</strong></div>
        <div className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Recent sessions</h3><Clock3 size={16} className="text-gray-400" /></div>{sessions.length === 0 ? <div className="focus-history-empty"><Clock3 size={20} /><p>Finished sessions will appear here.</p></div> : <ol className="space-y-2">{sessions.slice(0, 4).map((session) => <li key={session.id} className="focus-session-row"><span className="focus-session-check" style={{ color: session.moduleColor }}><Check size={14} /></span><div className="min-w-0 flex-1"><p className="truncate">{session.moduleCode}</p><span>{new Date(session.endedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {new Date(session.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><strong>{formatStudyTime(session.durationMs)}</strong></li>)}</ol>}</div>
      </aside>
    </section>
  );
}

export default StudyTimer;
