/**
 * The per-section "AI suggests" chip row — the FRONT END of the future
 * `recommend` capability.
 *
 * Pure presentational: it renders whatever `suggestions` it is given and reports
 * clicks upward. It holds NO suggestion logic — that lives in
 * `lib/suggestions.js` (`suggestForSection`), so the deterministic v1 source can
 * later be swapped for the LLM recommender (ai_judgement kind='recommend')
 * without touching this component.
 *
 * A chip names the story (title snippet) and its source; clicking it assigns the
 * story into the section. A trailing "Not relevant" control dismisses the whole
 * row for the session.
 */

/**
 * `busyId` is the id of the suggestion currently being assigned (shows a busy
 * state on that chip only); null when idle.
 */
export default function PulseSuggestRow({
  sectionFunctionId,
  suggestions,
  busyId,
  disabled,
  onAssign,
  onDismiss,
}) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mt-3 rounded-[10px] border border-[color:var(--pulse-accent-dim)] bg-primary/[0.06] px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-primary">
          <span aria-hidden="true">✦</span> AI suggests
        </span>
        <span className="text-[11px] italic text-muted-foreground">
          Suggested — accepting or dismissing this tunes the recommender
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
          disabled={disabled}
          className="ml-auto rounded-full border border-transparent px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-[color:var(--pulse-border-hi)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Not relevant ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => {
          const busy = busyId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); onAssign?.(s, sectionFunctionId); }}
              disabled={disabled || Boolean(busyId)}
              title={`Assign “${s.title}” to this section`}
              className={
                'inline-flex max-w-[280px] items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ' +
                (busy
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-[color:var(--pulse-border-hi)] bg-secondary text-foreground hover:border-primary')
              }
            >
              <span aria-hidden="true" className="shrink-0 text-primary">{busy ? '…' : '✦'}</span>
              <span className="min-w-0 truncate font-semibold">{s.title || 'Untitled story'}</span>
              {s.sourceName && (
                <span className="shrink-0 text-[11px] text-muted-foreground">· {s.sourceName}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
