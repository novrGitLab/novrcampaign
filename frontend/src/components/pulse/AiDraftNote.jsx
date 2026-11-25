import { Sparkles } from 'lucide-react';

/**
 * The one-line note shown under the write overlay's header once an AI draft has
 * loaded into the form. It tells the editor the text is machine-written and
 * MUST be reviewed/edited before it is added to the email — nothing more. Kept
 * tiny and presentational (no state, no I/O) per the minimal screen brief.
 *
 * @param {{ className?: string }} [props]
 */
export default function AiDraftNote({ className = '' }) {
  return (
    <p
      role="status"
      className={
        'flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-[12.5px] text-secondary-foreground ' +
        className
      }
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      AI drafted — review and edit before adding.
    </p>
  );
}
