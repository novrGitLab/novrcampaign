import { formatDistanceToNow } from 'date-fns';
import { Pencil, Archive, Trash2, ExternalLink } from 'lucide-react';
import { Badge, Button, SourcePill } from '../ui';

/**
 * One feed entry row: source pill, relative time, title, one-line summary,
 * status, "used in N campaigns", and Edit / Archive / Delete actions.
 */
export default function FeedEntryRow({ entry, onEdit, onArchive, onDelete }) {
  const relative = entry.publishedAt
    ? formatDistanceToNow(new Date(entry.publishedAt), { addSuffix: true })
    : '';

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <SourcePill sourceType={entry.sourceType} />
          <span className="text-xs text-muted-foreground">{entry.sourceName}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{relative}</span>
          <Badge status={entry.status.toUpperCase()}>{entry.status}</Badge>
          {entry.usedInCampaigns > 0 && (
            <span className="text-xs text-muted-foreground">
              Used in {entry.usedInCampaigns} campaign{entry.usedInCampaigns === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{entry.summary}</p>

        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          {entry.url}
        </a>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => onEdit(entry)} aria-label="Edit">
          <Pencil className="h-4 w-4" />
        </Button>
        {entry.status !== 'archived' && (
          <Button variant="ghost" size="sm" onClick={() => onArchive(entry)} aria-label="Archive">
            <Archive className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onDelete(entry)} aria-label="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
