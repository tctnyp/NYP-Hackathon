import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePwa } from '../contexts/PwaContext';

function NotificationPrompt() {
  const { user } = useAuth();
  const { isInstalled, notificationsSupported, notificationDeliveryReady, notificationsEnabled, notificationPermission, enableNotifications } = usePwa();
  const dismissedKey = `academic-notification-prompt-dismissed:${user?.sub || 'signed-out'}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return window.localStorage.getItem(dismissedKey) === 'true'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try { setDismissed(window.localStorage.getItem(dismissedKey) === 'true'); }
    catch { setDismissed(false); }
    setError('');
  }, [dismissedKey]);

  if (!user || !isInstalled || !notificationsSupported || !notificationDeliveryReady || notificationsEnabled || notificationPermission === 'denied' || dismissed) return null;

  const enable = async () => {
    setBusy(true);
    setError('');
    const enabled = await enableNotifications();
    if (!enabled) setError('We couldn’t enable notifications. Check your device settings and try again.');
    setBusy(false);
  };

  const dismiss = () => {
    try { window.localStorage.setItem(dismissedKey, 'true'); } catch { /* Keep in-memory dismissal. */ }
    setDismissed(true);
  };

  return (
    <section className="notification-prompt flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center" aria-labelledby="notification-prompt-title">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><BellRing size={21} /></span>
        <div><h2 id="notification-prompt-title" className="font-semibold">Stay focused on what’s next</h2><p className="notification-prompt-copy mt-1 text-sm leading-5">Get timely task reminders when you switch to another app. We respect quiet hours and send no more than three reminders a day.</p>{error && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{error}</p>}</div>
      </div>
      <div className="flex items-center gap-2"><button type="button" className="btn-primary flex-1 sm:flex-none" disabled={busy} onClick={() => void enable()}>{busy ? 'Enabling…' : 'Enable notifications'}</button><button type="button" className="notification-prompt-dismiss icon-button" onClick={dismiss} aria-label="Dismiss notification prompt"><X size={18} /></button></div>
    </section>
  );
}

export default NotificationPrompt;
