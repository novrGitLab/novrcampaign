import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, Undo2 } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import { Modal } from '../ui/Modal';

/**
 * One AI judgement in the review queue, with Accept / Reject actions.
 *
 * The row's `scenario` is the FROZEN input the model saw. For `dedup` that is
 * `{ a: { id, title, summary }, b: { id, title, summary } }` — the two possible
 * duplicate headlines — so we render the pair side by side. Other kinds
 * (`rewrite`, `recommend`) have no defined scenario yet; we render them
 * generically: the subject titles plus the verdict and rationale, never
 * crashing on an unknown shape.
 *
 * Reject opens a modal requiring a reason (min 3 chars, mirrored client-side).
 * The server re-enforces the minimum (400) and the one-way transition (409); we
 * surface its message inline. The reason is the training signal.
 *
 * @param {object} props
 * @param {object} props.judgement   a row from `useAiJudgements`
 * @param {(id: string) => void} props.onAccept
 * @param {(vars: { id: string, reason: string }) => Promise<unknown>} props.onReject
 * @param {boolean} [props.acceptPending]
 * @param {boolean} [props.rejectPending]
 */

const KIND_LABELS = { dedup: 'Dedup', rewrite: 'Rewrite', recommend: 'Recommend' };

/** Confidence 0–1 → whole-number percent, or null when unknown. */
function confidencePercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(Math.min(Math.max(value, 0), 1) * 100);
}

const DECISION_VERDICTS = {
  same_story: 'Likely the same story',
  distinct: 'Likely different',
};

/** The AI's verdict sentence plus a confidence Badge, if known. */
function Verdict({ decision, confidence }) {
  const pct = confidencePercent(confidence);
  const label = DECISION_VERDICTS[decision] || decision || 'Unknown verdict';
  const tone = decision === 'same_story' ? 'FAILED' : 'READY';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
        <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {label}
      </span>
      {pct !== null && <Badge status={tone}>{pct}% confident</Badge>}
    </div>
  );
}

/** One side of a dedup pair: source/summary + headline. */
function ScenarioSide({ label, item }) {
  if (!item) return null;
  return (
    <div className="min-w-0 flex-1 rounded-md border border-border bg-secondary/40 p-3">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{item.title || 'Untitled'}</p>
      {item.summary && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{item.summary}</p>}
    </div>
  );
}

/** The two headlines of a dedup scenario, side by side (stacked on small screens). */
function DedupScenario({ scenario, subject }) {
  const a = scenario?.a;
  const b = scenario?.b;
  if (!a && !b) {
    // Scenario missing — fall back to the resolved subject titles.
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <ScenarioSide label="A" item={{ title: subject?.eventTitle }} />
        <ScenarioSide label="B" item={{ title: subject?.counterpartTitle }} />
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ScenarioSide label="A" item={a} />
      <ScenarioSide label="B" item={b} />
    </div>
  );
}

/** Reject modal: a reason is REQUIRED (min 3 chars, mirrored client-side). */
function RejectModal({ open, judgement, onClose, onSubmit, pending }) {
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState(null);
  const errorId = useId();
  const textareaRef = useRef(null);

  // Reset the form each time the modal opens for a (possibly new) judgement and
  // move focus into the textarea so the dialog is immediately keyboard-usable.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setServerError(null);
    textareaRef.current?.focus();
  }, [open, judgement?.id]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 3;
  const canSubmit = trimmed.length >= 3 && !pending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setServerError(null);
    try {
      await onSubmit({ id: judgement.id, reason: trimmed });
      onClose();
    } catch (err) {
      // The server message is authoritative (400 too short / 409 adjudicated).
      setServerError(err.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reject this AI decision"
      description="Why is the AI wrong? Your reason trains the model and is required."
      className="max-w-xl"
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="ai-reject-reason" className="label">
            Reasoning <span className="text-destructive" aria-hidden="true">*</span>
          </label>
          <textarea
            id="ai-reject-reason"
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            required
            aria-required="true"
            aria-invalid={tooShort || Boolean(serverError)}
            aria-describedby={serverError || tooShort ? errorId : undefined}
            placeholder="e.g. Same bank, but two separate incidents — not the same story."
            className="input min-h-[8rem] w-full text-sm"
          />
        </div>

        {tooShort && (
          <p id={errorId} className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Please give at least 3 characters of reasoning.
          </p>
        )}
        {serverError && (
          <p id={errorId} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleSubmit} disabled={!canSubmit}>
            <Undo2 className="h-4 w-4" />
            {pending ? 'Rejecting…' : 'Reject'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AiJudgementCard({ judgement, onAccept, onReject, acceptPending, rejectPending }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState(null);

  if (!judgement) return null;

  const kindLabel = KIND_LABELS[judgement.kind] || judgement.kind || 'Unknown';
  const busy = acceptPending || rejectPending;

  const handleAccept = async () => {
    setAcceptError(null);
    try {
      await onAccept(judgement.id);
      // Brief inline confirmation; the card is removed from the list by the
      // optimistic cache update, so this only shows if the row lingers.
      setAccepted(true);
    } catch (err) {
      setAcceptError(err.message);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge status="DRAFT">{kindLabel}</Badge>
        {judgement.outcome && judgement.outcome !== 'pending' && (
          <Badge status={judgement.outcome === 'accepted' ? 'READY' : 'FAILED'}>{judgement.outcome}</Badge>
        )}
        {judgement.createdAt && (
          <span className="text-xs text-muted-foreground">{new Date(judgement.createdAt).toLocaleString()}</span>
        )}
      </div>

      {judgement.kind === 'dedup' ? (
        <DedupScenario scenario={judgement.scenario} subject={judgement.subject} />
      ) : (
        <div className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
          {judgement.subject?.eventTitle || judgement.subject?.counterpartTitle || 'No scenario preview available for this kind.'}
        </div>
      )}

      <div className="mt-3">
        <Verdict decision={judgement.decision} confidence={judgement.confidence} />
        {judgement.rationale && (
          <p className="mt-1 text-sm text-muted-foreground">{judgement.rationale}</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleAccept} disabled={busy}>
          <Check className="h-3.5 w-3.5" />
          {acceptPending ? 'Accepting…' : 'Accept'}
        </Button>
        <Button variant="danger" size="sm" onClick={() => setRejectOpen(true)} disabled={busy}>
          <Undo2 className="h-3.5 w-3.5" />
          Reject
        </Button>
        {accepted && (
          <span aria-live="polite" className="text-xs text-muted-foreground">Accepted.</span>
        )}
      </div>

      {acceptError && (
        <p role="alert" className="mt-2 text-xs text-destructive">{acceptError}</p>
      )}

      <RejectModal
        open={rejectOpen}
        judgement={judgement}
        pending={rejectPending}
        onClose={() => setRejectOpen(false)}
        onSubmit={onReject}
      />
    </Card>
  );
}
