import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/campaigns', { method: 'POST', body }).then((r) => r.campaign),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id:string; body:Record<string,unknown> }) => {
      if (!id) throw new Error('Save the draft first — there is no campaign to update yet.');
      return api(`/campaigns/${id}`, { method: 'PUT', body }).then((r) => r.campaign);
    },
    onSuccess: (campaign) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.setQueryData(['campaign', campaign.id], campaign);
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledFor }: { id:string; scheduledFor?:string }) =>
      api(`/campaigns/${id}/send`, { method: 'POST', body: scheduledFor ? { scheduledFor } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useScheduleCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledFor }: { id:string; scheduledFor?:string }) => {
      if (!id) throw new Error('Save the draft first — there is no campaign to schedule yet.');
      return api(`/campaigns/${id}/schedule`, { method: 'POST', body: { scheduledFor } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/campaigns/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useTestCampaign() {
  return useMutation({
    mutationFn: ({ id, email }: { id:string; email:string }) => {
      if (!id) throw new Error('Save the draft first — there is no campaign to test yet.');
      return api(`/campaigns/${id}/test`, { method: 'POST', body: { email } });
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/contacts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, checkMx = true }: { file:File; checkMx?:boolean }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (!checkMx) formData.append('checkMx', 'false');
      return api('/contacts/import', { method: 'POST', formData });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useResendUnsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/campaigns/${id}/resend-unsent`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['segments'] });
    },
  });
}

export function useDuplicateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/campaigns/${id}/duplicate`, { method: 'POST' }).then((r) => r.campaign),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/templates', { method: 'POST', body }).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDuplicateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/templates/${id}/duplicate`, { method: 'POST' }).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useCreateSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/segments', { method: 'POST', body }).then((r) => r.segment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segments'] }),
  });
}

export function useDeleteSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/segments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segments'] }),
  });
}

export function useSegmentMembers(id) {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: (body: Record<string, unknown>) => api(`/segments/${id}/members`, { method: 'POST', body }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['segment-contacts', id] });
        qc.invalidateQueries({ queryKey: ['segment', id] });
      },
    }),
    remove: useMutation({
      mutationFn: (emails: string[]) => api(`/segments/${id}/members`, { method: 'DELETE', body: { emails } }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['segment-contacts', id] });
        qc.invalidateQueries({ queryKey: ['segment', id] });
      },
    }),
  };
}

export function useBulkContactAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action:string; ids:string[] }) => api(`/contacts/bulk-${action}`, { method: 'POST', body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

// ── Feed ─────────────────────────────────────────────────────────────────────

export function useCreateFeedEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/feed', { method: 'POST', body }).then((r) => r.entry),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useUpdateFeedEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id:string; body:Record<string,unknown> }) => api(`/feed/${id}`, { method: 'PUT', body }).then((r) => r.entry),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useDeleteFeedEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/feed/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useInsertFeedEntry(campaignId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      api(`/campaigns/${campaignId}/feed-entries`, { method: 'POST', body: { entryId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign-feed-entries', campaignId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

// ── NovrPulse publish actions ────────────────────────────────────────────────

function invalidatePulse(qc) {
  qc.invalidateQueries({ queryKey: ['pulse-events'] });
  qc.invalidateQueries({ queryKey: ['pulse-event'] });
  qc.invalidateQueries({ queryKey: ['publish'] });
  // The Front Page's unassigned-drafts tray reads ['publish-items', …]; a
  // create-from-event that succeeds but fails to attach would otherwise leave
  // the orphan item invisible until a manual refresh.
  qc.invalidateQueries({ queryKey: ['publish-items'] });
}

/** POST /api/publish/f7 — project eligible F7 events into draft items.
 *  Dry-run unless `commit: true` (matches `projectSchema` in the controller). */
export function useProjectF7() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown> = {}) => api('/publish/f7', { method: 'POST', body }),
    onSuccess: () => invalidatePulse(qc),
  });
}

export function useApprovePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/publish/${id}/approve`, { method: 'POST' }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

export function useRejectPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/publish/${id}/reject`, { method: 'POST' }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

export function useEditPublish() {
  const qc = useQueryClient();
  return useMutation({
    // `payload` may carry `body`, `regulatoryImpact`, and/or `eventDate`; only
    // the keys present are sent, so PATCH persists exactly what the writer saved.
    mutationFn: ({ id, ...payload }: { id:string; body?:string;eventDate?:string;regulatoryImpact?:string }) => api(`/publish/${id}`, { method: 'PATCH', body: payload }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

/** PATCH /api/pulse/events/:id/review — persist Accept/Dismiss ("new" | "accepted" | "dismissed").
 *  Optimistically patches the cached list, then invalidates on settle so the
 *  server's persisted value wins. Non-destructive: only the status is written. */
export function useReviewPulseEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id:string; status:string }) =>
      api(`/pulse/events/${id}/review`, { method: 'PATCH', body: { status } }).then((r) => r.event),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['pulse-events'] });
      const snapshots = qc.getQueriesData({ queryKey: ['pulse-events'] });
      qc.setQueriesData<{ items: Array<{id: string; reviewStatus: string}> }>({ queryKey: ['pulse-events'] }, (prev) => {
        if (!prev?.items) return prev;
        return {
          ...prev,
          items: prev.items.map((it) => (it.id === id ? { ...it, reviewStatus: status } : it)),
        };
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['pulse-events'] }),
  });
}

/**
 * POST /api/pulse/collect/run — trigger ONE real collection run from sources.
 *
 * The guard lives server-side (controller `runPulseCollection`): it accepts the
 * cron bearer secret OR an authenticated ADMIN session, and returns 401 for
 * anyone else. There is no silent fallback and no query params are trusted, so
 * the client sends an empty body (the server defaults `maxAgeDays`). On success
 * the list caches are invalidated so the pulled stories appear immediately.
 * Errors are surfaced to the caller (the page maps 403 → a graceful message).
 */
export function useRunPulseCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/pulse/collect/run', { method: 'POST' }),
    onSuccess: () => invalidatePulse(qc),
  });
}

/** POST /api/publish/from-event — create a writable editorial item FROM an
 *  accepted inbox event for a chosen pillar (the Editorial Canvas entry point).
 *  The server seeds the body deterministically and runs the defamation gate. */
export function useCreateItemFromEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, functionId }: { eventId:string; functionId:number }) =>
      api('/publish/from-event', { method: 'POST', body: { eventId, functionId } }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

// ── AI editorial layer (rewrite + recommend) ─────────────────────────────────

/**
 * POST /api/publish/ai-draft — AI-rewrite one event into a pillar draft.
 *
 * Creates (or reuses, `existed: true`) a publish_item whose body is the
 * AI-written `"<headline>\n\nUPPER_SLOT_LABEL\n<slot text>"` composition. The
 * server runs the copyright-overlap guard and the F7 defamation gate BEFORE
 * writing, so a refusal (422 `DRAFT_TOO_CLOSE_TO_SOURCE` /
 * `named_individual_in_public_arrest`) or a missing provider (503
 * `AI_NOT_CONFIGURED`) rejects the promise with a normalised error (the caller
 * reads `err.status` / `err.code`). Existing item + judgement list caches are
 * invalidated on success so the new draft appears in "In today's email".
 *
 * `regenerate: true` asks the server for a FRESH draft over the existing live
 * item (updated in place, same id, a new ledger row appended) — the Retry
 * action in the edition wizard's Drafts step. Default false keeps the
 * idempotent "return the existing draft" behaviour.
 */
export function useAiDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, functionId, regenerate = false }: { eventId:string; functionId:number; regenerate?:boolean }) =>
      api('/publish/ai-draft', { method: 'POST', body: { eventId, functionId, regenerate } }),
    onSuccess: () => invalidatePulse(qc),
  });
}

/**
 * POST /api/ai/recommend — ask the AI for per-section story picks.
 *
 * Returns `{ recommendations: [{ functionId, judgements: [...] }] }`. Each pick
 * is also recorded as a `recommend` judgement (outcome 'pending') in the
 * `ai_judgement` ledger, so the review queue is refetched on success.
 */
export function useRecommendEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown> = {}) => api('/ai/recommend', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-judgements'] });
      invalidatePulse(qc);
    },
  });
}

// ── AI judgement review ────────────────────────────────────────────────────
// Adjudication is a ONE-WAY transition out of `pending` server-side. The row
// leaves the pending queue on success, so we optimistically remove it from the
// cached `['ai-judgements']` lists and invalidate on settle (the server's view
// wins). A 409 (already adjudicated) still settles back to a fresh fetch.

/** Remove one judgement from every cached `['ai-judgements']` list. */
function removeJudgementFromCache(qc, id) {
  qc.setQueriesData({ queryKey: ['ai-judgements'] }, (prev) => {
    if (!Array.isArray(prev)) return prev;
    return prev.filter((j) => j.id !== id);
  });
}

function optimisticJudgementRemoval(qc, id) {
  return async () => {
    await qc.cancelQueries({ queryKey: ['ai-judgements'] });
    const snapshots = qc.getQueriesData({ queryKey: ['ai-judgements'] });
    removeJudgementFromCache(qc, id);
    return { snapshots };
  };
}

function rollbackJudgements(qc, ctx) {
  for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
}

/** POST /api/ai-judgements/:id/accept — confirm the AI's verdict. */
export function useAcceptJudgement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/ai-judgements/${id}/accept`, { method: 'POST' }).then((r) => r.judgement),
    onMutate: (id) => optimisticJudgementRemoval(qc, id)(),
    onError: (_err, _id, ctx) => rollbackJudgements(qc, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai-judgements'] }),
  });
}

/** POST /api/ai-judgements/:id/reject — reject the AI's verdict with a REASON.
 *  The reason is required training signal; the server enforces a minimum length
 *  (400 when too short, 409 when already adjudicated). */
export function useRejectJudgement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id:string; reason:string }) =>
      api(`/ai-judgements/${id}/reject`, { method: 'POST', body: { reason } }).then((r) => r.judgement),
    onMutate: ({ id }) => optimisticJudgementRemoval(qc, id)(),
    onError: (_err, _vars, ctx) => rollbackJudgements(qc, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai-judgements'] }),
  });
}
