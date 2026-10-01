import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Mail, LogOut, UsersRound, LayoutTemplate,
  ChevronsLeft, ChevronsRight, Search, Bell, Sun, Moon, ChevronRight, AlertTriangle, Menu,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { Badge } from './ui';
import { useCampaigns, useHealth } from '../hooks/queries';
import CommandPalette from './CommandPalette';

const GROUPS = [
  {
    label: 'Build',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/campaigns', label: 'Campaigns', icon: Mail, badge: 'failed' },
      { to: '/templates', label: 'Templates', icon: LayoutTemplate },
      { to: '/segments', label: 'Segments', icon: UsersRound },
    ],
  },
  {
    label: 'Audience',
    items: [{ to: '/contacts', label: 'Contacts', icon: Users }],
  },
];

const CRUMB_NAMES = {
  '': 'Dashboard',
  contacts: 'Contacts',
  campaigns: 'Campaigns',
  new: 'New',
  edit: 'Edit',
  analytics: 'Analytics',
  segments: 'Segments',
  templates: 'Templates',
};

function useBreadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [{ label: 'Workspace', to: '/' }];
  let acc = '';
  parts.forEach((p) => {
    acc += `/${p}`;
    crumbs.push({ label: CRUMB_NAMES[p] ?? (p.length > 8 ? `${p.slice(0, 8)}…` : p), to: acc });
  });
  return crumbs;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const crumbs = useBreadcrumbs();
  const { data: health } = useHealth();
  const { data: campaigns = [] } = useCampaigns();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('novr.sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const failed = campaigns.filter((c) => c.status === 'FAILED');

  useEffect(() => {
    localStorage.setItem('novr.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed ]);

  useEffect(() => {
    setBellOpen(false);
    setMenuOpen(false);
    setMobileOpen(false);
  }, [location.pathname ]);

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

  const onLogout = () => {
    logout();
    navigate('/login');
  };

  const sidebar = (isMobile) => (
      <aside
        className={cn(
          'flex h-screen shrink-0 flex-col overflow-y-auto bg-brand-ink text-white transition-[width] duration-200',
          collapsed && !isMobile ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('pb-2 pt-6', collapsed ? 'px-3' : 'px-6')}>
          <img
            src="/cybernovr-logo-white.png"
            alt="CyberNovr"
            className={cn('w-auto', collapsed ? 'h-6' : 'h-8')}
          />
          {!collapsed && (
            <>
              <div className="mt-3 flex items-center gap-2">
                <p className="text-sm font-bold leading-none">NovrCampaign</p>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
                  Internal
                </span>
              </div>
              <div className="mt-3 h-1 w-full rounded-full bg-linear-to-r from-brand-blue via-brand-purple to-brand-red" />
            </>
          )}
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {GROUPS.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon, end, badge }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        collapsed && 'justify-center px-0',
                        isActive ? 'bg-brand-purple text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="flex-1">{label}</span>}
                    {!collapsed && badge === 'failed' && failed.length > 0 && (
                      <span className="rounded-full bg-brand-red px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                        {failed.length > 99 ? '99+' : failed.length}
                      </span>
                    )}
                    {collapsed && badge === 'failed' && failed.length > 0 && (
                      <span className="absolute ml-6 mt-[-18px] h-2 w-2 rounded-full bg-brand-red" />
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn('border-t border-white/10 p-4', collapsed && 'px-3')}>
          {!collapsed && (
            <div className="mb-3 flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
              <span className="text-xs font-medium text-white/60">Plunk</span>
              <Badge status={health?.checks?.plunk === 'configured' ? 'valid' : 'not_configured'}>
                {health?.checks?.plunk === 'configured' ? 'Connected' : 'No API key'}
              </Badge>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{user?.name || user?.email}</p>
                <p className="text-xs text-white/50">CyberNovr team</p>
              </div>
            )}
            <button
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
              className="rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {!isMobile && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="mt-3 flex w-full items-center justify-center rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          )}
        </div>
      </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-secondary/40">
      <div className="hidden md:block">{sidebar(false)}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-brand-ink/55" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">{sidebar(true)}</div>
        </div>
      )}

      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.to}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                {i === crumbs.length - 1 ? (
                  <span className="truncate font-semibold">{c.label}</span>
                ) : (
                  <button onClick={() => navigate(c.to)} className="hidden truncate text-muted-foreground hover:text-foreground sm:block">
                    {c.label}
                  </button>
                )}
              </span>
            ))}
          </nav>

          <div className="flex-1" />

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-md border bg-secondary/60 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent md:flex"
          >
            <Search className="h-4 w-4" />
            <span>Search…</span>
            <kbd className="rounded border bg-card px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent md:hidden"
          >
            <Search className="h-4 w-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => { setBellOpen((v) => !v); setMenuOpen(false); }}
              aria-label="Notifications"
              className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              {failed.length > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">
                  {failed.length > 9 ? '9+' : failed.length}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-11 w-80 rounded-lg border bg-card p-2 text-card-foreground shadow-lg animate-fade-rise">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Notifications
                </p>
                {failed.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">All clear — no failed sends.</p>
                ) : (
                  failed.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setBellOpen(false); navigate(`/campaigns/${c.id}/analytics`); }}
                      className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-red" />
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

          <div className="relative">
            <button
              onClick={() => { setMenuOpen((v) => !v); setBellOpen(false); }}
              aria-label="Account"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-800 dark:bg-purple-900 dark:text-purple-100"
            >
              {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 w-56 rounded-lg border bg-card p-2 text-card-foreground shadow-lg animate-fade-rise">
                <p className="truncate px-3 pb-1 pt-2 text-sm font-medium">{user?.name || user?.email}</p>
                <p className="truncate px-3 pb-2 text-xs text-muted-foreground">{user?.email}</p>
                <button
                  onClick={toggle}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default Layout;
