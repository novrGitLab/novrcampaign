import { Rss } from 'lucide-react';
import { EmptyState, PageHeader } from '../components/ui';

/**
 * Feed — staff-recorded cybersecurity updates for the current week.
 * P1 ships the section shell; capture/list arrive in P2.
 */
export default function Feed() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-8">
      <PageHeader
        title="Feed"
        description="Record this week's cybersecurity updates and add them to a newsletter."
      />

      <EmptyState
        icon={<Rss className="h-10 w-10" />}
        title="No updates this week"
        description="Capture the week's X posts, news and regulator notices — a short summary plus a source link."
      />
    </div>
  );
}
