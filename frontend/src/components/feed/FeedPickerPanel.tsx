import { useMemo, useState } from 'react';
import { Search, Plus } from '../ui/icons';
import { Badge, Button, EmptyState, SourcePill, WeekNavigator } from '../ui';
import { useFeedEntries } from '../../hooks/queries';
import { addWeeks, weekLabel, weekStartIso } from '../../lib/feedWeek';

// Escape text for safe embedding in HTML (email body).
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Email-safe (table-based, inline styles) HTML block for one feed entry: the
// summary plus a "Source: {sourceName} — link" line. Snapshot — later edits to
// the entry do not change text already inserted.
export function renderFeedBlock(entry) {
  const summary = escapeHtml(entry.summary);
  const sourceName = escapeHtml(entry.sourceName);
  const href = escapeHtml(entry.url);
  const linkText = escapeHtml(entry.url);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="border-collapse:collapse;margin:0 0 16px 0;">` +
    `<tr>` +
    `<td style="padding:12px 14px;border-left:3px solid #662F8E;background:#F6F1FB;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#0C0C13;">` +
    `<p style="margin:0 0 8px 0;">${summary}</p>` +
    `<p style="margin:0;font-size:12px;line-height:18px;color:#4E4E61;">` +
    `Source: ${sourceName} — <a href="${href}" style="color:#4451A2;text-decoration:underline;">${linkText}</a>` +
    `</p>` +
    `</td>` +
    `</tr>` +
    `</table>`
  );
}

/**
 * Right-side collapsible picker inside CampaignBuilder. Lists the week's feed
 * entries with a summary preview and an Insert per entry. No batch insert.
 */
export default function FeedPickerPanel({ onInsert, insertingId, insertedIds = [] }) {
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [query, setQuery] = useState('');

  const { data, isLoading } = useFeedEntries({
    weekStart: weekStartIso(weekAnchor),
    q: query.trim() || undefined,
  });
  const entries = data?.entries ?? [];
  const label = useMemo(() => weekLabel(weekAnchor), [weekAnchor]);

  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div className="flex flex-col gap-2">
        <WeekNavigator
          label={label}
          onPrev={() => setWeekAnchor((d) => addWeeks(d, -1))}
          onNext={() => setWeekAnchor((d) => addWeeks(d, 1))}
          onToday={() => setWeekAnchor(new Date())}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this week…"
            className="input pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && entries.length === 0 && (
          <EmptyState
            title="Nothing this week"
            description="Add updates on the Feed page, then insert them here."
          />
        )}
        {entries.map((entry) => {
          const inserted = insertedIds.includes(entry.id);
          return (
            <div key={entry.id} className="rounded-lg border border-border bg-card p-3">
              <div className="mb-1 flex items-center gap-2">
                <SourcePill sourceType={entry.sourceType} />
                <Badge status={entry.status.toUpperCase()}>{entry.status}</Badge>
                {inserted && (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Inserted</span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{entry.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{entry.summary}</p>
              <div className="mt-2 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onInsert(entry)}
                  disabled={insertingId === entry.id}
                >
                  <Plus className="h-4 w-4" />
                  {insertingId === entry.id ? 'Inserting…' : 'Insert'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
