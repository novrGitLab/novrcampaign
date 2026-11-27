import { ShieldAlert, AlertTriangle, UserMinus } from './ui/icons';
import { useSuppressions } from '../hooks/queries';
import { StatCard, StatCardSkeleton } from './ui';
import { formatNumber } from '../lib/utils';
import { TIP } from '../lib/metrics';

/**
 * The suppression analytics block — suppressed total, hard bounces,
 * spam complaints and unsubscribes — shared by the Dashboard and the
 * Analytics page so the numbers always match the Suppressions page.
 */
export default function SuppressionStats({ isLoading: loadingProp = false }) {
  const { data, isLoading } = useSuppressions();
  const counts = data?.counts ?? { BOUNCE: 0, COMPLAINT: 0, UNSUBSCRIBED: 0, total: 0 };
  const loading = loadingProp || isLoading;

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Suppressed"
        value={formatNumber(counts.total)}
        hint="excluded from future campaigns"
        icon={<ShieldAlert className="h-4 w-4" />}
        accent="blue"
        tip={TIP.suppressed}
      />
      <StatCard
        label="Hard bounces"
        value={formatNumber(counts.BOUNCE)}
        hint="invalid or dead mailboxes"
        icon={<AlertTriangle className="h-4 w-4" />}
        accent="red"
        tip={TIP.bounced}
      />
      <StatCard
        label="Spam complaints"
        value={formatNumber(counts.COMPLAINT)}
        hint="reported as spam"
        icon={<ShieldAlert className="h-4 w-4" />}
        accent="purple"
        tip={TIP.complained}
      />
      <StatCard
        label="Unsubscribed"
        value={formatNumber(counts.UNSUBSCRIBED)}
        hint="clicked unsubscribe"
        icon={<UserMinus className="h-4 w-4" />}
        accent="red"
        tip={TIP.unsubscribed}
      />
    </div>
  );
}

/* Inline row divider label used above the suppression block */
export function SectionNote({ children }) {
  return (
    <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      <ShieldAlert className="h-3.5 w-3.5" />
      {children}
    </p>
  );
}
