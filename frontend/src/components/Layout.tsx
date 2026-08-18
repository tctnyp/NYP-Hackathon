import { Link, useLocation } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Download,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Shield,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ThemePreference, useTheme } from '../contexts/ThemeContext';
import { usePwa } from '../contexts/PwaContext';
import BackgroundPicker from './BackgroundPicker';

interface LayoutProps {
  children: ReactNode;
}

const primaryNavigation = [
  { name: 'Home', desktopName: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Tasks', desktopName: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Calendar', desktopName: 'Calendar', href: '/calendar', icon: CalendarDays },
  { name: 'Modules', desktopName: 'Modules', href: '/modules', icon: BookOpen },
];

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, signOut, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const { canInstall, isInstalled, isOnline, install } = usePwa();
  const [moreOpen, setMoreOpen] = useState(false);

  const desktopNavigation = [
    ...primaryNavigation,
    ...(isAdmin() ? [{ name: 'Admin', desktopName: 'Admin Panel', href: '/admin', icon: Shield }] : []),
  ];

  const isActive = (path: string) => location.pathname === path;
  const pageName = desktopNavigation.find((item) => isActive(item.href))?.desktopName || 'Academic Tasks';
  const moreActive = isActive('/admin');

  const handleSignOut = async () => {
    setMoreOpen(false);
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const themePicker = (
    <div className="theme-picker" role="group" aria-label="Color theme">
      {themeOptions.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={theme === option.value ? 'theme-option theme-option-active' : 'theme-option'}
            aria-pressed={theme === option.value}
            onClick={() => setTheme(option.value)}
          >
            <Icon size={16} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="app-shell min-h-[100dvh]">
      <header className="app-surface safe-top fixed inset-x-0 top-0 z-30 border-b px-4 pb-3 pt-3 lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-600 shadow-sm">
              <CheckSquare className="text-white" size={22} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-500">Academic Tasks</p>
              <h1 className="truncate text-lg font-bold leading-tight">{pageName}</h1>
            </div>
          </div>
          {!isOnline && (
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
              <WifiOff size={14} /> Offline
            </span>
          )}
        </div>
      </header>

      <aside className="app-surface fixed inset-y-0 left-0 z-20 hidden w-72 flex-col border-r lg:flex">
        <div className="flex items-center gap-3 border-b px-6 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-600 shadow-sm">
            <CheckSquare className="text-white" size={25} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Academic Tasks</h1>
            <p className="text-xs text-gray-500">Study planner</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4" aria-label="Main navigation">
          {desktopNavigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? 'desktop-nav-item desktop-nav-active' : 'desktop-nav-item'}
              >
                <Icon size={20} />
                <span>{item.desktopName}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-4 border-t p-4">
          {themePicker}
          <details className="appearance-details rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Customize background</summary>
            <div className="mt-4"><BackgroundPicker /></div>
          </details>
          {canInstall && (
            <button type="button" className="btn-secondary flex w-full items-center justify-center gap-2" onClick={() => void install()}>
              <Download size={18} /> Install app
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.username || 'User'}</p>
              <p className="text-xs text-gray-500">{isAdmin() ? 'Administrator' : isInstalled ? 'Installed app' : 'Student'}</p>
            </div>
            <button type="button" onClick={handleSignOut} className="icon-button hover:text-red-600" aria-label="Sign out">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </aside>

      <main className="pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[calc(4.75rem+env(safe-area-inset-top))] lg:pb-0 lg:pl-72 lg:pt-0">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
      </main>

      <nav className="android-nav safe-bottom lg:hidden" aria-label="Mobile navigation">
        {primaryNavigation.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={active ? 'android-nav-item android-nav-active' : 'android-nav-item'}
              onClick={() => setMoreOpen(false)}
            >
              <span className="android-nav-indicator"><Icon size={22} /></span>
              <span>{item.name}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={moreOpen || moreActive ? 'android-nav-item android-nav-active' : 'android-nav-item'}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="android-nav-indicator"><MoreHorizontal size={23} /></span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-black/45 lg:hidden" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <section className="android-sheet safe-bottom lg:hidden" aria-label="More options">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Signed in as</p>
                <h2 className="font-semibold">{user?.username || 'User'}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Close menu">
                <X size={22} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {isAdmin() && (
                <Link to="/admin" className="more-tile" onClick={() => setMoreOpen(false)}>
                  <Shield size={22} /> <span>Admin</span>
                </Link>
              )}
              {canInstall && (
                <button type="button" className="more-tile" onClick={() => void install()}>
                  <Download size={22} /> <span>Install app</span>
                </button>
              )}
              <button type="button" className="more-tile text-red-600" onClick={handleSignOut}>
                <LogOut size={22} /> <span>Sign out</span>
              </button>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Appearance</p>
              {themePicker}
              <div className="mt-5"><BackgroundPicker /></div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Layout;
