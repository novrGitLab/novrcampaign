import { Sparkles } from '../ui/icons';

/** Friendly copy for each AI-draft guard warning code (owner decision: warn, not block). */
const WARNING_MESSAGES = {
  too_close_to_source: 'too close to the source — consider editing before adding',
  names_individual: 'it names an individual — review carefully',
};

/**
 * Map a guard warning code to its friendly sentence. Unknown codes are dropped
 * (defensive) so a future server code never renders raw.
 *
 * @param {string} code
 * @returns {string|null}
 */
export function warningMessage(code) {
  return WARNING_MESSAGES[code] ?? null;
}

/**
 * The note shown under the write overlay's header once an Suggested draft has loaded
 * into the form. It tells the editor the text is machine-written and MUST be
 * reviewed/edited before it is added to the email.
 *
 * When the Suggested draft tripped a guard (copyright overlap / named individual), the
 * server still SAVES it and returns `warnings`; those render here as an amber
 * banner (owner decision: warn, not block) so the editor is informed and
 * decides at approval. Kept presentational (no state, no I/O).
 *
 * @param {{ warnings?: string[], className?: string }} [props]
 */
export default function AiDraftNote({ warnings = [], className = '' }) {
  const messages = (warnings ?? [])
    .map(warningMessage)
    .filter(Boolean);

  return (
    <div className={className}>
      <p
        role="status"
        className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-[12.5px] text-secondary-foreground"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Review the draft against the source before adding it.
      </p>
      {messages.length > 0 && (
        <p
          role="alert"
          className="mt-2 flex flex-col gap-0.5 rounded-md bg-warning/10 px-3 py-2 text-[12.5px] text-warning"
        >
          {messages.map((m) => (
            <span key={m}>⚠ Saved with a warning: {m}.</span>
          ))}
        </p>
      )}
    </div>
  );
}
