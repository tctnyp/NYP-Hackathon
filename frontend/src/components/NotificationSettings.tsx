import { useState } from 'react';
import { BellOff, BellRing, Download, Send, Share } from 'lucide-react';
import { usePwa } from '../contexts/PwaContext';

function NotificationSettings() {
  const {
    canInstall,
    isInstalled,
    isIosDevice,
    notificationsSupported,
    notificationDeliveryReady,
    notificationsEnabled,
    notificationPermission,
    install,
    enableNotifications,
    disableNotifications,
    showNotification,
  } = usePwa();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const enable = async () => {
    setBusy(true);
    setMessage('');
    const enabled = await enableNotifications();
    setMessage(enabled ? 'Task guidance notifications are enabled for this account.' : 'Notifications could not be enabled.');
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const shown = await showNotification({ title: 'Focus guidance is ready', body: 'We’ll recommend your task at hand and tell you what comes next.', tag: 'academic-task-guidance-test', url: '/tasks' });
    setMessage(shown ? 'Test notification sent.' : 'The test notification could not be sent.');
    setBusy(false);
  };

  return (
    <section className="card" aria-labelledby="notifications-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${notificationsEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{notificationsEnabled ? <BellRing size={21} /> : <BellOff size={21} />}</span>
          <div><h2 id="notifications-heading" className="text-lg font-semibold">Task guidance notifications</h2><p className="mt-1 max-w-xl text-sm leading-6 text-gray-500">While the installed PWA is backgrounded, receive timely recommendations for your task at hand and what to do next. Closed-app push delivery is not enabled.</p></div>
        </div>
        {notificationsEnabled && <span className="w-fit rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Enabled</span>}
      </div>

      <div className="mt-5 flex flex-wrap gap-2" aria-label="Notification delivery policy">
        <span className="status-pill status-neutral">Quiet 10 PM–8 AM</span>
        <span className="status-pill status-neutral">Maximum 3 per day</span>
        <span className="status-pill status-neutral">Urgent deadlines prioritized</span>
      </div>

      <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)' }}>
        {!isInstalled && isIosDevice ? (
          <div className="flex items-start gap-3"><Share size={20} className="mt-0.5 shrink-0 text-primary-600" /><div><p className="text-sm font-semibold">Add this app to your Home Screen first</p><p className="mt-1 text-sm leading-6 text-gray-600">In Safari, tap Share, choose “Add to Home Screen,” then open Academic Tasks from its new icon. Notifications require iOS or iPadOS 16.4 or later.</p></div></div>
        ) : !notificationsSupported ? (
          <p className="text-sm text-gray-600">Notifications aren’t supported by this browser or device.</p>
        ) : !isInstalled ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-600">Install Academic Tasks as an app before enabling task guidance.</p>{canInstall && <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => void install()}><Download size={17} /> Install app</button>}</div>
        ) : !notificationDeliveryReady ? (
          <p className="text-sm leading-6 text-amber-700">Notification delivery is still starting or the service worker could not load. Refresh the app and try again.</p>
        ) : notificationPermission === 'denied' ? (
          <p className="text-sm leading-6 text-amber-700">Notifications are blocked in your device settings. Allow notifications for Academic Tasks, then return here.</p>
        ) : notificationsEnabled ? (
          <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void test()}><Send size={16} /> Send test</button><button type="button" className="btn-secondary text-red-600" onClick={() => { disableNotifications(); setMessage('Task guidance notifications are off for this account.'); }}>Turn off</button></div>
        ) : (
          <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy} onClick={() => void enable()}><BellRing size={17} /> {busy ? 'Enabling…' : 'Enable notifications'}</button>
        )}
        {message && <p className="mt-3 text-sm font-medium text-gray-600" role="status">{message}</p>}
      </div>
    </section>
  );
}

export default NotificationSettings;
