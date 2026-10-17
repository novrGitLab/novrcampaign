import { Info } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Small hover/focus info tooltip. `content` is plain text (see lib/metrics.js
 * for the shared glossary). Positioned above the icon so it works inside
 * cards and table headers alike.
 */
export function InfoTip({ content, label, className }) {
  if (!content) return null;
  return (
    <span className={cn('group/tip relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label || 'More info'}
        className="rounded-full p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed text-card-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {content}
        <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-border bg-card" />
      </span>
    </span>
  );
}

export function Button({ variant = 'primary', size, className, children, ...props }) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  };
  return (
    <button className={cn(variants[variant], size === 'sm' && 'btn-sm', className)} {...props}>
      {children}
    </button>
  );
}

export function Card({ className, children }) {
  return <div className={cn('card', className)}>{children}</div>;
}

export function CardHeader({ className, children }) {
  return <div className={cn('card-header', className)}>{children}</div>;
}

export function CardTitle({ className, children }) {
  return <h3 className={cn('card-title', className)}>{children}</h3>;
}

export function CardContent({ className, children }) {
  return <div className={cn('card-content', className)}>{children}</div>;
}

/* Soft, Plunk-style status pills */
const STATUS_STYLES = {
  // Campaign statuses
  DRAFT: 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  SCHEDULED: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20',
  SENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20',
  SENT: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  CANCELLED: 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  FAILED: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20',
  // Contact states
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  SUBSCRIBED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  UNSUBSCRIBED: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20',
  BOUNCED: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20',
  COMPLAINED: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20',
  SUPPRESSED: 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  // Health
  connected: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  valid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  not_configured: 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  invalid: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20',
  // Template types
  STATIC: 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  DYNAMIC: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20',
  MARKETING: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20',
  TRANSACTIONAL: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  HEADLESS: 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
};

export function Badge({ status, className, children }) {
  const style = STATUS_STYLES[status] || 'bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-white/10 dark:text-white/70 dark:ring-white/10';
  return <span className={cn('badge', style, className)}>{children ?? status}</span>;
}

export function Input({ className, ...props }) {
  return <input className={cn('input', className)} {...props} />;
}

export function Label({ className, children, ...props }) {
  return (
    <label className={cn('label', className)} {...props}>
      {children}
    </label>
  );
}

/* Search field with leading icon — Plunk toolbar pattern */
export function SearchInput({ icon, className, ...props }) {
  return (
    <div className={cn('relative w-full', className)}>
      {icon && (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
          {icon}
        </span>
      )}
      <input
        type="search"
        className={cn('input rounded-lg pl-9', icon ? 'pl-9' : 'pl-3')}
        {...props}
      />
    </div>
  );
}

/* Outline filter pill used in Plunk toolbars */
export function PillButton({ active, className, children, ...props }) {
  return (
    <button
      className={cn(
        'btn-secondary h-9 rounded-lg px-3 text-sm font-medium',
        active && 'bg-accent text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h3 className="mb-1 text-[15px] font-semibold text-foreground">{title}</h3>
      {description && <p className="mb-6 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/* CyberNovr logo accent tints (red / blue / purple) for icon tiles */
const ACCENTS = {
  blue: 'bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/20 dark:text-blue-300',
  purple: 'bg-brand-purple/10 text-brand-purple dark:bg-brand-purple/25 dark:text-purple-300',
  red: 'bg-brand-red/10 text-brand-red dark:bg-brand-red/15 dark:text-red-400',
};

/* Plunk stat card: label + icon tile, big value, hint */
export function StatCard({ label, value, hint, icon, badge, accent, tip }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            {label}
            <InfoTip content={tip} />
          </p>
          <span className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            ACCENTS[accent] || 'bg-secondary text-muted-foreground',
          )}>
            {icon}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
          {badge}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-7 w-20" />
        <div className="skeleton h-3 w-32" />
      </CardContent>
    </Card>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} />;
}
