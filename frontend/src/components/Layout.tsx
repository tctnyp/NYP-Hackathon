import { Link, useLocation } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Download,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Settings,
  Shield,
  Target,
  WifiOff,
  X,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { usePwa } from '../contexts/PwaContext';

interface LayoutProps {
  children: ReactNode;
}

const primaryNavigation = [
  { name: 'Home', desktopName: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Tasks', desktopName: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Calendar', desktopName: 'Calendar', href: '/calendar', icon: CalendarDays },
  { name: 'Modules', desktopName: 'Modules', href: '/modules', icon: BookOpen },
];

function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, signOut, isAdmin } = useAuth();
  const { profile } = useAccount();
  const { canInstall, isInstalled, isOnline, install } = usePwa();
  const [moreOpen, setMoreOpen] = useState(false);

  const desktopNavigation = [
    ...primaryNavigation,
    { name: 'Priority', desktopName: 'Priority View', href: '/priority', icon: Target },
    ...(isAdmin() ? [{ name: 'Admin', desktopName: 'Admin Panel', href: '/admin', icon: Shield }] : []),
  ];

  const isActive = (path: string) => location.pathname === path;
  const pageName = isActive('/account/settings')
    ? 'Account Settings'
    : desktopNavigation.find((item) => isActive(item.href))?.desktopName || 'Academic Tasks';
  const moreActive = isActive('/priority') || isActive('/admin') || isActive('/account/settings');
  const displayName = profile.display_name || user?.preferred_username || user?.username || 'User';

  const handleSignOut = async () => {
    setMoreOpen(false);
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

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

        <div className="space-y-3 border-t p-4">
          {canInstall && (
            <button type="button" className="btn-secondary flex w-full items-center justify-center gap-2" onClick={() => void install()}>
              <Download size={18} /> Install app
            </button>
          )}
          <div className="flex items-center gap-2">
            <Link
              to="/account/settings"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-gray-100"
              aria-current={isActive('/account/settings') ? 'page' : undefined}
            >
              {profile.profile_picture ? (
                <img src={profile.profile_picture} alt="" className="h-10 w-10 shrink-0 rounded-full border object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700">
                  {displayName[0]?.toUpperCase() || 'U'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="text-xs text-gray-500">{isAdmin() ? 'Administrator' : isInstalled ? 'Installed app' : 'Account settings'}</p>
              </div>
              <Settings size={18} className="shrink-0 text-gray-500" />
            </Link>
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
              <Link to="/account/settings" className="flex min-w-0 items-center gap-3 rounded-xl" onClick={() => setMoreOpen(false)}>
                {profile.profile_picture ? (
                  <img src={profile.profile_picture} alt="" className="h-11 w-11 shrink-0 rounded-full border object-cover" />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700">
                    {displayName[0]?.toUpperCase() || 'U'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-500">Signed in as</p>
                  <h2 className="truncate font-semibold">{displayName}</h2>
                </div>
              </Link>
              <button type="button" className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Close menu">
                <X size={22} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link to="/priority" className="more-tile" onClick={() => setMoreOpen(false)}>
                <Target size={22} /> <span>Priority</span>
              </Link>
              <Link to="/account/settings" className="more-tile" onClick={() => setMoreOpen(false)}>
                <Settings size={22} /> <span>Account</span>
              </Link>
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
          </section>
        </>
      )}
    </div>
  );
}

export default Layout;
