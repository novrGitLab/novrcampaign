import { cn } from '../../lib/utils';

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

const STATUS_STYLES = {
  // Campaign statuses (Plunk)
  DRAFT: 'bg-secondary text-foreground',
  SCHEDULED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  SENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  SENT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  CANCELLED: 'bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white/60',
  FAILED: 'bg-destructive/15 text-destructive',
  // Contact states
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  SUBSCRIBED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  UNSUBSCRIBED: 'bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white/60',
  BOUNCED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  COMPLAINED: 'bg-destructive/15 text-destructive',
  SUPPRESSED: 'bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white/60',
  connected: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  valid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  not_configured: 'bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white/60',
  invalid: 'bg-destructive/15 text-destructive',
  STATIC: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  DYNAMIC: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  MARKETING: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  TRANSACTIONAL: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  HEADLESS: 'bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white/60',
};

export function Badge({ status, className, children }) {
  const style = STATUS_STYLES[status] || 'bg-secondary text-foreground';
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

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      {description && <p className="mb-6 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {icon && (
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200">
              {icon}
            </span>
          )}
        </div>
        <p className="mt-2 text-[28px] font-bold leading-8 tabular-nums tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-3 w-40" />
      </CardContent>
    </Card>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} />;
}
