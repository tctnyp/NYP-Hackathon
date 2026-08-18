import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export interface PwaNotification {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

interface PwaContextValue {
  canInstall: boolean;
  isInstalled: boolean;
  isOnline: boolean;
  isIosDevice: boolean;
  notificationsSupported: boolean;
  notificationDeliveryReady: boolean;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  install: () => Promise<boolean>;
  enableNotifications: () => Promise<boolean>;
  disableNotifications: () => void;
  showNotification: (notification: PwaNotification) => Promise<boolean>;
}

const PREFERENCE_PREFIX = 'academic-tasks-notifications-enabled';
const PwaContext = createContext<PwaContextValue | undefined>(undefined);

function detectInstalled() {
  return ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen']
    .some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
    || Boolean((window.navigator as NavigatorWithStandalone).standalone);
}

function detectIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function notificationSupport() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

function readPreference(key: string | null) {
  if (!key) return false;
  try { return window.localStorage.getItem(key) === 'true'; } catch { return false; }
}

function serviceWorkerReadyWithin(timeoutMs: number) {
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Service worker readiness timed out.')), timeoutMs);
    void navigator.serviceWorker.ready.then((registration) => {
      window.clearTimeout(timeout);
      resolve(registration);
    }, (error) => {
      window.clearTimeout(timeout);
      reject(error);
    });
  });
}

async function clearTaskNotifications(registration: ServiceWorkerRegistration) {
  const notifications = await registration.getNotifications();
  notifications
    .filter((notification) => notification.tag?.startsWith('academic-task-guidance'))
    .forEach((notification) => notification.close());
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const preferenceKey = user?.sub ? `${PREFERENCE_PREFIX}:${user.sub}` : null;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(detectInstalled);
  const [isOnline, setIsOnline] = useState(window.navigator.onLine);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    () => notificationSupport() ? Notification.permission : 'unsupported',
  );
  const [notificationPreference, setNotificationPreference] = useState(false);
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState<string | null>(null);
  const [serviceWorkerReady, setServiceWorkerReady] = useState(!import.meta.env.PROD);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const previousUserRef = useRef<string | null>(null);
  const cleanupPendingRef = useRef(false);
  const notificationsSupported = notificationPermission !== 'unsupported';
  const notificationDeliveryReady = notificationsSupported && serviceWorkerReady;
  const notificationsEnabled = notificationDeliveryReady
    && loadedPreferenceKey === preferenceKey
    && notificationPermission === 'granted'
    && notificationPreference;

  useEffect(() => {
    setNotificationPreference(readPreference(preferenceKey));
    setLoadedPreferenceKey(preferenceKey);
  }, [preferenceKey]);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === preferenceKey) setNotificationPreference(event.newValue === 'true');
    };
    window.addEventListener('storage', syncPreference);
    return () => window.removeEventListener('storage', syncPreference);
  }, [preferenceKey]);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };
    const handleDisplayMode = () => setIsInstalled(detectInstalled());
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const refreshPermission = () => {
      if (notificationSupport()) setNotificationPermission(Notification.permission);
    };
    const displayQueries = ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen']
      .map((mode) => window.matchMedia(`(display-mode: ${mode})`));

    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', refreshPermission);
    displayQueries.forEach((query) => query.addEventListener('change', handleDisplayMode));

    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      setServiceWorkerReady(false);
      navigator.serviceWorker.register('/sw.js')
        .then(async (registration) => {
          registrationRef.current = registration;
          if (cleanupPendingRef.current) {
            try {
              await clearTaskNotifications(registration);
              cleanupPendingRef.current = false;
            } catch (error) {
              console.error('Unable to clear prior task guidance:', error);
            }
          }
          const readyRegistration = registration.active
            ? registration
            : await serviceWorkerReadyWithin(12_000);
          registrationRef.current = readyRegistration;
          setServiceWorkerReady(true);
          if (cleanupPendingRef.current) {
            void clearTaskNotifications(readyRegistration)
              .then(() => { cleanupPendingRef.current = false; })
              .catch((error) => console.error('Unable to clear prior task guidance:', error));
          }
        })
        .catch((error) => {
          setServiceWorkerReady(false);
          console.error('Service worker registration failed:', error);
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', refreshPermission);
      displayQueries.forEach((query) => query.removeEventListener('change', handleDisplayMode));
    };
  }, []);

  useEffect(() => {
    const currentUser = user?.sub || null;
    const previousUser = previousUserRef.current;
    previousUserRef.current = currentUser;
    if (!previousUser || previousUser === currentUser || !('serviceWorker' in navigator)) return;

    cleanupPendingRef.current = true;
    void (async () => {
      try {
        const registration = registrationRef.current || await navigator.serviceWorker.getRegistration();
        if (!registration) return;
        await clearTaskNotifications(registration);
        cleanupPendingRef.current = false;
      } catch (error) {
        console.error('Unable to clear prior task guidance:', error);
      }
    })();
  }, [user?.sub]);

  const showNotification = async (notification: PwaNotification) => {
    if (!preferenceKey || !notificationSupport() || Notification.permission !== 'granted' || !readPreference(preferenceKey)) return false;
    const options: NotificationOptions = {
      body: notification.body,
      tag: notification.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: notification.url || '/dashboard' },
    };

    try {
      if (import.meta.env.PROD) {
        if (!serviceWorkerReady || !registrationRef.current) return false;
        await registrationRef.current.showNotification(notification.title, options);
      } else {
        const browserNotification = new Notification(notification.title, options);
        browserNotification.onclick = () => {
          window.focus();
          window.location.assign(notification.url || '/dashboard');
          browserNotification.close();
        };
      }
      return true;
    } catch (error) {
      console.error('Unable to show notification:', error);
      return false;
    }
  };

  const value = useMemo<PwaContextValue>(() => ({
    canInstall: Boolean(installPrompt) && !isInstalled,
    isInstalled,
    isOnline,
    isIosDevice: detectIos(),
    notificationsSupported,
    notificationDeliveryReady,
    notificationsEnabled,
    notificationPermission,
    install: async () => {
      if (!installPrompt) return false;
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
        setIsInstalled(true);
        return true;
      }
      return false;
    },
    enableNotifications: async () => {
      if (!preferenceKey || !notificationSupport() || !isInstalled || !serviceWorkerReady) return false;
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      setNotificationPermission(permission);
      if (permission !== 'granted') return false;
      try { window.localStorage.setItem(preferenceKey, 'true'); } catch { return false; }
      setNotificationPreference(true);
      return true;
    },
    disableNotifications: () => {
      if (preferenceKey) {
        try { window.localStorage.setItem(preferenceKey, 'false'); } catch { /* Device storage may be unavailable. */ }
      }
      setNotificationPreference(false);
      if (registrationRef.current) {
        void clearTaskNotifications(registrationRef.current)
          .catch((error) => console.error('Unable to clear task guidance:', error));
      }
    },
    showNotification,
  }), [installPrompt, isInstalled, isOnline, notificationDeliveryReady, notificationPermission, notificationPreference, notificationsEnabled, notificationsSupported, preferenceKey, serviceWorkerReady]);

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) throw new Error('usePwa must be used within PwaProvider');
  return context;
}
