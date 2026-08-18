import { Link, useLocation } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  CheckSquare2,
  Download,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Settings,
  Shield,
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
  { name: 'Home', desktopName: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Tasks', desktopName: 'My tasks', href: '/tasks', icon: CheckSquare2 },
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
    ...(isAdmin() ? [{ name: 'Admin', desktopName: 'Admin', href: '/admin', icon: Shield }] : []),
  ];

  const isActive = (path: string) => location.pathname === path;
  const pageName = isActive('/account/settings')
    ? 'Account settings'
    : desktopNavigation.find((item) => isActive(item.href))?.desktopName || 'Academic Tasks';
  const moreActive = isActive('/admin') || isActive('/account/settings');
  const displayName = profile.display_name || user?.preferred_username || user?.username || 'User';

  const handleSignOut = async () => {
    setMoreOpen(false);
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const avatar = (size = 'h-10 w-10') => profile.profile_picture ? (
    <img src={profile.profile_picture} alt="" className={`${size} shrink-0 rounded-full border object-cover`} />
  ) : (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700`}>
      {displayName[0]?.toUpperCase() || 'U'}
    </div>
  );

  return (
    <div className="app-shell min-h-[100dvh]">
      <header className="app-surface safe-top fixed inset-x-0 top-0 z-30 border-b px-4 pb-3 pt-3 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark h-10 w-10">
              <CheckSquare2 size={21} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Academic Tasks</p>
              <h1 className="truncate text-lg font-semibold leading-tight">{pageName}</h1>
            </div>
          </div>
          {!isOnline && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
              <WifiOff size={14} /> Offline
            </span>
          )}
        </div>
      </header>

      <aside className="app-surface fixed inset-y-0 left-0 z-20 hidden w-[17rem] flex-col border-r lg:flex">
        <Link to="/dashboard" className="flex items-center gap-3 px-6 py-6" aria-label="Academic Tasks home">
          <div className="brand-mark h-11 w-11"><CheckSquare2 size={23} /></div>
          <div>
            <h1 className="text-[1.05rem] font-semibold tracking-tight">Academic Tasks</h1>
            <p className="mt-0.5 text-xs text-gray-500">Plan less. Accomplish more.</p>
          </div>
        </Link>

        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main navigation">
          <p className="mb-2 px-3 text-[0.67rem] font-bold uppercase tracking-[0.14em] text-gray-400">Workspace</p>
          <div className="space-y-1">
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
                  <Icon size={19} strokeWidth={active ? 2.4 : 2} />
                  <span>{item.desktopName}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="space-y-3 border-t p-3">
          {canInstall && (
            <button type="button" className="btn-secondary flex w-full items-center justify-center gap-2" onClick={() => void install()}>
              <Download size={17} /> Install app
            </button>
          )}
          <div className="flex items-center gap-1 rounded-2xl p-1.5 transition hover:bg-gray-100">
            <Link
              to="/account/settings"
              className="flex min-w-0 flex-1 items-center gap-3 p-1"
              aria-current={isActive('/account/settings') ? 'page' : undefined}
            >
              {avatar()}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{displayName}</p>
                <p className="truncate text-xs text-gray-500">{isAdmin() ? 'Administrator' : isInstalled ? 'Installed app' : 'Manage account'}</p>
              </div>
              <Settings size={17} className="shrink-0 text-gray-400" />
            </Link>
            <button type="button" onClick={handleSignOut} className="icon-button hover:text-red-600" aria-label="Sign out" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <main className="pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[calc(4.75rem+env(safe-area-inset-top))] lg:pb-0 lg:pl-[17rem] lg:pt-0">
        <div className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-10">{children}</div>
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
              <span className="android-nav-indicator"><Icon size={21} strokeWidth={active ? 2.5 : 2} /></span>
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
          <span className="android-nav-indicator"><MoreHorizontal size={22} /></span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <section className="android-sheet safe-bottom lg:hidden" aria-label="More options">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-gray-200" aria-hidden="true" />
            <div className="mb-5 flex items-center justify-between">
              <Link to="/account/settings" className="flex min-w-0 items-center gap-3 rounded-xl" onClick={() => setMoreOpen(false)}>
                {avatar('h-11 w-11')}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-500">Signed in as</p>
                  <h2 className="truncate font-semibold">{displayName}</h2>
                </div>
              </Link>
              <button type="button" className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Close menu"><X size={21} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link to="/account/settings" className="more-tile" onClick={() => setMoreOpen(false)}><Settings size={21} /> <span>Account</span></Link>
              {isAdmin() && <Link to="/admin" className="more-tile" onClick={() => setMoreOpen(false)}><Shield size={21} /> <span>Admin</span></Link>}
              {canInstall && <button type="button" className="more-tile" onClick={() => void install()}><Download size={21} /> <span>Install app</span></button>}
              <button type="button" className="more-tile text-red-600" onClick={handleSignOut}><LogOut size={21} /> <span>Sign out</span></button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default Layout;
