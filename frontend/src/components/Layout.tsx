import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Mail, LogOut, UsersRound, LayoutTemplate,
  Search, Sun, Moon, ShieldAlert, Menu, X, ChevronDown, Bell, AlertTriangle,
  BarChart3, Rss, Radar, PanelLeftClose, PanelLeftOpen,
} from './ui/icons';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { Badge } from './ui';
import { useCampaigns, useHealth } from '../hooks/queries';
import CommandPalette from './CommandPalette';

// Desktop sidebar collapse state — persisted per browser so the choice sticks.
const SIDEBAR_COLLAPSED_KEY = 'novr.sidebarCollapsed';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/feed', label: 'Feed', icon: Rss },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/segments', label: 'Segments', icon: UsersRound },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/suppressions', label: 'Suppressions', icon: ShieldAlert },
];

const AUTOMATIONS = [
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
];

// Pulse is a grouped section. The minimal desk is ONE screen ("Today"), so the
// group holds a single item; future surfaces slot in as additional children.
const PULSE = {
  label: 'Pulse',
  items: [
    { to: '/pulse', label: 'Newsroom', icon: Radar, end: true },
  ],
};

const BOTTOM = [
  { to: '/campaigns', label: 'Campaigns', icon: Mail, badge: 'failed' },
];

function NavItem({ to, label, icon: Icon, end=false, badge=undefined, collapsed, onClick }) {
  const path = usePathname();
  const isActive = path === to || (!end && path.startsWith(to + '/'));
  return (
    <Link
      href={to}
      aria-current={isActive ? "page" : undefined}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={
        cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-brand-purple/10 text-brand-purple dark:bg-brand-purple/25 dark:text-purple-200'
            : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
        )
      }
    >

        <>
          {isActive && (
            <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-linear-to-b from-brand-blue via-brand-purple to-brand-red" />
          )}
          <Icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1">{label}</span>}
          {!collapsed && badge === 'failed' && <FailedBadge collapsed={false} />}
          {collapsed && badge === 'failed' && <FailedBadge collapsed />}
        </>

    </Link>
  );
}

function FailedBadge({ collapsed }) {
  const { data: campaigns = [] } = useCampaigns();
  const failed = campaigns.filter((c) => c.status === 'FAILED');
  if (failed.length === 0) return null;
  if (collapsed) {
    return <span className="ml-4 mt-[-16px] h-2 w-2 shrink-0 rounded-full bg-destructive" />;
  }
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-white">
      {failed.length > 99 ? '99+' : failed.length}
    </span>
  );
}

function useClickOutside(handler, refs) {
  useEffect(() => {
    const onDown = (e) => {
      if (refs.some((r) => r.current && !r.current.contains(e.target))) handler();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [handler, refs]);
}

export function Layout({children}: {children: React.ReactNode}) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { data: health } = useHealth();
  const { data: campaigns = [] } = useCampaigns();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop collapse (icon-only rail). Defaults expanded; persisted per browser.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const bellRef = useRef(null);
  const menuRef = useRef(null);

  const failed = campaigns.filter((c) => c.status === 'FAILED');

  useClickOutside(() => setBellOpen(false), [bellRef]);
  useClickOutside(() => setMenuOpen(false), [menuRef]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // Storage unavailable (private mode, quota) — collapse state is cosmetic.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setBellOpen(false);
    setMenuOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onLogout = async () => {
    await logout();
    router.push('/login');
  };

  const sidebar = (isMobile) => {
    // The collapse rail is a desktop affordance only; mobile always shows full.
    const collapsed = !isMobile && sidebarCollapsed;
    return (
    <aside
      className={cn(
        'flex h-dvh shrink-0 flex-col overflow-y-auto border-r border-border bg-background',
        collapsed ? 'w-16' : 'w-60',
      )}
    >

      <div className={cn('flex items-center pb-1 pt-5', collapsed ? 'flex-col gap-2 px-2' : 'justify-between px-4')}>
        <a href="/pulse" className="desk-brand" aria-label="NovrPulse editorial desk">{collapsed ? "N" : <>Novr<i>Pulse</i></>}</a>
        {!isMobile && (
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
        {!collapsed && (
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="hidden items-center gap-0.5 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
          >
            ⌘K
          </button>
        )}
      </div>


      <div className={cn('mt-2 h-0.5 rounded-full bg-linear-to-r from-brand-blue via-brand-purple to-brand-red', collapsed ? 'mx-2' : 'mx-4')} />


      {!collapsed && <p className="desk-kicker px-4 pt-4">Editorial desk</p>}


      <nav className={cn('mt-4 flex-1 space-y-4 overflow-y-auto pb-4', collapsed ? 'px-2' : 'px-3')}>
        <div className="space-y-0.5">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} onClick={isMobile ? () => setMobileOpen(false) : undefined} />
          ))}
        </div>

        <div>
          {!collapsed && (
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {PULSE.label}
            </p>
          )}
          <div className="space-y-0.5">
            {PULSE.items.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} onClick={isMobile ? () => setMobileOpen(false) : undefined} />
            ))}
          </div>
        </div>

        <div>
          {!collapsed && (
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              Automations
            </p>
          )}
          <div className="space-y-0.5">
            {AUTOMATIONS.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} onClick={isMobile ? () => setMobileOpen(false) : undefined} />
            ))}
          </div>
        </div>

        <div className="space-y-0.5">
          {BOTTOM.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} onClick={isMobile ? () => setMobileOpen(false) : undefined} />
          ))}
        </div>
      </nav>


      <div className="border-t border-border p-3">
        {health?.checks?.plunk && !collapsed && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-secondary px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Delivery service</span>
            <Badge status={health?.checks?.plunk === 'configured' ? 'connected' : 'not_configured'}>
              {health?.checks?.plunk === 'configured' ? 'Configured' : 'Unavailable'}
            </Badge>
          </div>
        )}


        <div className="relative" ref={bellRef}>
          <button
            onClick={() => { setBellOpen((v) => !v); setMenuOpen(false); }}
            title={collapsed ? 'Notifications' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <span className="relative">
              <Bell className="h-4 w-4" />
              {failed.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {failed.length > 9 ? '9+' : failed.length}
                </span>
              )}
            </span>
            {!collapsed && <span className="flex-1 text-left">Notifications</span>}
          </button>
          {bellOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-border bg-card p-2 shadow-lg animate-fade-rise">
              <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Notifications
              </p>
              {failed.length === 0 ? (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">All clear — no failed sends.</p>
              ) : (
                failed.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setBellOpen(false); router.push(`/campaigns/${c.id}/analytics`); }}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-secondary/70"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>
                      <span className="block text-sm font-medium">“{c.name}” failed to send</span>
                      <span className="block text-xs text-muted-foreground">Review and retry from analytics</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>


        <div className="relative" ref={menuRef}>
          <button
            onClick={() => { setMenuOpen((v) => !v); setBellOpen(false); }}
            title={collapsed ? (user?.name || user?.email) : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-[11px] font-bold text-emerald-700 dark:bg-emerald-600/25 dark:text-emerald-300">
              {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {user?.name || user?.email}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
          {menuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-border bg-card p-1.5 shadow-lg animate-fade-rise">
              <p className="truncate px-2 pb-1 pt-1.5 text-sm font-medium">{user?.name || user?.email}</p>
              <p className="truncate px-2 pb-2 text-xs text-muted-foreground">{user?.email}</p>
              <button
                onClick={toggle}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary/70"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button
                onClick={onLogout}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
    );
  };

  return (
    <div className="staff-shell flex h-dvh overflow-hidden bg-background">
      <div className="hidden md:block">{sidebar(false)}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar(true)}
          </div>
        </div>
      )}

      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">

        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
          >
            <Menu className="h-4 w-4" />
          </button>
          <img src="/cybernovr-logo.png" alt="CyberNovr" className="h-6 w-auto" />
          <div className="flex-1" />
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
          >
            <Search className="h-4 w-4" />
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={pathname} className="page-enter">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default Layout;
