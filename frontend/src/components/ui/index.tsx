type PanelProps={className?:string;children?:React.ReactNode};
import { Info, ChevronLeft, ChevronRight } from './icons';
import { cn } from '../../lib/utils';
import { PulseKingfisher } from './PulseKingfisher';

/**
 * Small hover/focus info tooltip. `content` is plain text (see lib/metrics.js
 * for the shared glossary). Positioned above the icon so it works inside
 * cards and table headers alike.
 */
export function InfoTip({ content, label, className }: {content?:React.ReactNode;label?:string;className?:string}) {
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

export function Button({ variant = 'primary', size, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'danger'|'ghost';size?:'sm'}) {
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

export function Card({ className, children }: PanelProps) {
  return <div className={cn('card', className)}>{children}</div>;
}

export function CardHeader({ className, children }: PanelProps) {
  return <div className={cn('card-header', className)}>{children}</div>;
}

export function CardTitle({ className, children }: PanelProps) {
  return <h3 className={cn('card-title', className)}>{children}</h3>;
}

export function CardContent({ className, children }: PanelProps) {
  return <div className={cn('card-content', className)}>{children}</div>;
}

/* Soft, Plunk-style status pills */
const STATUS_STYLES = {
  // Campaign statuses
  DRAFT: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  SCHEDULED: 'bg-info/10 text-info ring-info/20 dark:bg-info/15 dark:ring-info/30',
  SENDING: 'bg-warning/10 text-warning ring-warning/20 dark:bg-warning/15 dark:ring-warning/30',
  SENT: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  CANCELLED: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  FAILED: 'bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/15 dark:ring-destructive/30',
  // Feed entry statuses
  READY: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  ARCHIVED: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/50 dark:ring-white/10',
  // Contact states
  ACTIVE: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  SUBSCRIBED: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  UNSUBSCRIBED: 'bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/15 dark:ring-destructive/30',
  BOUNCED: 'bg-warning/10 text-warning ring-warning/20 dark:bg-warning/15 dark:ring-warning/30',
  COMPLAINED: 'bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/15 dark:ring-destructive/30',
  SUPPRESSED: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  // Health
  connected: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  valid: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  not_configured: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  invalid: 'bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/15 dark:ring-destructive/30',
  // Template types
  STATIC: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
  DYNAMIC: 'bg-info/10 text-info ring-info/20 dark:bg-info/15 dark:ring-info/30',
  MARKETING: 'bg-info/10 text-info ring-info/20 dark:bg-info/15 dark:ring-info/30',
  TRANSACTIONAL: 'bg-success/10 text-success ring-success/20 dark:bg-success/15 dark:ring-success/30',
  HEADLESS: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
};

export function Badge({ status, className, children }: PanelProps & {status?:string}) {
  const style = STATUS_STYLES[status] || 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10';
  return <span className={cn('badge', style, className)}>{children ?? status}</span>;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />;
}

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('label', className)} {...props}>
      {children}
    </label>
  );
}

/* Search field with optional leading icon */
export function SearchInput({ icon, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & {icon?:React.ReactNode}) {
  return (
    <div className={cn('relative w-full', className)}>
      {icon && (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-info">
          {icon}
        </span>
      )}
      <input
        type="search"
        className={cn('input rounded-lg', icon && 'pl-9')}
        {...props}
      />
    </div>
  );
}

export function PillButton({ active, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {active?:boolean}) {
  return (
    <Button type="button" variant="secondary" aria-pressed={Boolean(active)} className={cn('px-3', className)} {...props}>
      {children}
    </Button>
  );
}

export function EmptyState({ icon, title, description, action }: {icon?:React.ReactNode;title:string;description?:React.ReactNode;action?:React.ReactNode}) {
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
  blue: 'bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/20',
  purple: 'bg-brand-purple/10 text-highlight dark:bg-brand-purple/25',
  red: 'bg-brand-red/10 text-brand-red dark:bg-brand-red/15',
};

/* Plunk stat card: label + icon tile, big value, hint */
export function StatCard({ label, value, hint, icon, badge, accent, tip }: {label:string;value:React.ReactNode;hint?:React.ReactNode;icon?:React.ReactNode;badge?:React.ReactNode;accent?:string;tip?:React.ReactNode}) {
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

export function StaffPageTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1 className={cn('staff-page-title', className)}>
      <PulseKingfisher />
      <span>{children}</span>
    </h1>
  );
}

export function PageHeader({ title, description, actions }: {title:string;description?:React.ReactNode;actions?:React.ReactNode}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <StaffPageTitle className="text-xl font-bold tracking-tight text-foreground">{title}</StaffPageTitle>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: {className?:string}) {
  return <div className={cn('skeleton', className)} />;
}

/* Week navigator: prev / This week / next with the range label between the
   arrows. Used by the Feed page and the campaign picker so both stay in step. */
export function WeekNavigator({ label, onPrev, onNext, onToday, className }: {label:string;onPrev:()=>void;onNext:()=>void;onToday:()=>void;className?:string}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Button variant="secondary" size="sm" onClick={onPrev} aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[150px] text-center text-sm font-medium tabular-nums text-foreground">{label}</span>
      <Button variant="secondary" size="sm" onClick={onNext} aria-label="Next week">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="secondary" size="sm" onClick={onToday}>
        This week
      </Button>
    </div>
  );
}

/* Source-type pill for feed entries (x / news / regulator / other). Reuses the
   badge classes; distinct colors per type, no new tokens. */
const SOURCE_STYLES = {
  x: 'bg-foreground text-white ring-foreground/20 dark:bg-white/15 dark:text-white dark:ring-white/10',
  news: 'bg-info/10 text-info ring-info/20 dark:bg-info/15 dark:ring-info/30',
  regulator: 'bg-warning/10 text-warning ring-warning/20 dark:bg-warning/15 dark:ring-warning/30',
  other: 'bg-muted text-muted-foreground ring-border dark:bg-white/10 dark:text-white/70 dark:ring-white/10',
};

const SOURCE_LABELS = { x: 'X', news: 'News', regulator: 'Regulator', other: 'Other' };

export function SourcePill({ sourceType, className }: {sourceType:string;className?:string}) {
  const style = SOURCE_STYLES[sourceType] || SOURCE_STYLES.other;
  return <span className={cn('badge', style, className)}>{SOURCE_LABELS[sourceType] || 'Other'}</span>;
}
