import PillarIcon from './PillarIcon';
import { pillarLabel } from '../../lib/pillars';

/**
 * Compact "drafts for this story" strip — a single horizontal row of small
 * pillar + status-dot chips. This is deliberately NOT a list of cards: it is a
 * writing-surface tab strip. No body preview, no card chrome; max ~1 line tall.
 * Clicking a chip loads that draft into the editor; the trailing "+" starts a
 * new piece (falls back to the choose state).
 */
const DOT_BY_STATUS = {
  approved: 'bg-emerald-500',
  published: 'bg-emerald-500',
  draft: 'bg-neutral-400',
  rejected: 'bg-rose-500',
  withdrawn: 'bg-neutral-300',
};

const LABEL_BY_STATUS = {
  draft: 'draft',
  approved: 'approved',
  published: 'published',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

function DraftChip({ item, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-current={active ? 'true' : undefined}
      className={
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
        (active
          ? 'border-brand-purple bg-brand-purple/10 text-brand-purple'
          : 'border-border bg-card text-muted-foreground hover:border-brand-purple/40 hover:text-foreground')
      }
    >
      <PillarIcon functionId={item.functionId} className="h-3.5 w-3.5" />
      <span className="max-w-[12rem] truncate">{pillarLabel(item.functionId)}</span>
      <span aria-hidden="true" className="text-muted-foreground/50">·</span>
      <span className={'h-1.5 w-1.5 rounded-full ' + (DOT_BY_STATUS[item.status] || 'bg-neutral-400')} />
      <span className="capitalize">{LABEL_BY_STATUS[item.status] || item.status}</span>
    </button>
  );
}

export default function CanvasDraftStrip({ items, activeId, onSelect, onNew }) {
  if (items.length === 0) return null;
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Drafts for this story"
    >
      {items.map((item) => (
        <DraftChip key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
      ))}
      <button
        type="button"
        onClick={onNew}
        title="Start another piece"
        aria-label="Start another piece"
        className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-brand-purple/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        +
      </button>
    </div>
  );
}
