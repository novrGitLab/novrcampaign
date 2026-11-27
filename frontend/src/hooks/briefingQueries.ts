import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

/**
 * Briefing Desk data hooks.
 *
 * Kept in its own module (rather than growing queries.js/mutations.js) so the
 * Briefing Desk surface — its list/detail reads and every section/item mutation
 * — stays in one place. All reads go through `api()`; mutations invalidate the
 * affected briefing caches so the composed desk re-renders from the server.
 *
 * Server shapes (see backend/src/controllers/briefingController.js):
 *  - list:   { briefings: [{ id, briefingDate, status, title, publishedAt,
 *              scheduledFor, sectionCounts, sectionTotal }] }
 *  - detail: { briefing: { id, briefingDate, status, title, sections: [
 *              { id, functionId, label, position, state, note, itemCount,
 *                supportingCount, items: [{ id, position, publishItemId,
 *                publishItem: { id, functionId, contentType, status,
 *                bodyPreview, approvedAt, publishedAt } | null }] } ] } }
 *  - every section write returns { section } (the fresh serialized section).
 */

// ── Briefing reads ───────────────────────────────────────────────────────────

/** List briefings, newest first. `from`/`to` are ISO dates; `status` optional. */
export function useBriefings({ from, to, status }: {from?:string;to?:string;status?:string} = {}) {
  return useQuery({
    queryKey: ['briefings', { from, to, status }],
    queryFn: () =>
      api('/briefings', { query: { from, to, status } }).then((r) => r.briefings ?? []),
    staleTime: 15_000,
  });
}

/** One briefing with its eight sections and their ordered items. */
export function useBriefing(id) {
  return useQuery({
    queryKey: ['briefing', id],
    queryFn: () => api(`/briefings/${id}`).then((r) => r.briefing),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

/**
 * POST /api/briefings/:id/preview — render the assembled briefing through the
 * email template and return `{ html }`. A mutation (not a query): the preview is
 * an explicit user action and always re-renders from the current composition.
 * The returned HTML is untrusted article text and is ONLY ever displayed inside a
 * sandboxed iframe — never injected into the app DOM.
 */
export function usePreviewBriefing(id) {
  return useMutation({
    mutationFn: () => api(`/briefings/${id}/preview`, { method: 'POST' }).then((r) => r.html),
  });
}

/**
 * POST /api/briefings/:id/publish — Publish → Preview → Send.
 *
 * `{ test: true, email? }` sends ONE test copy to `email` (or the signed-in
 * user's own address); `{ segments? }` sends the rendered briefing to the given
 * Plunk segments (or the configured `NP_PULSE_SEGMENT`). On a successful
 * production send the briefing is marked published server-side, so both the
 * list and the detail caches are invalidated.
 *
 * The server renders the SAME email the preview shows (one renderer), so the
 * caller never passes HTML — only the send intent.
 */
export function usePublishBriefing(id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/briefings/${id}/publish`, { method: 'POST', body }),
    onSuccess: () => invalidateBriefings(qc, id),
  });
}

// ── Briefing mutations ───────────────────────────────────────────────────────

/** Invalidate both the list and a briefing's detail after any write. */
function invalidateBriefings(qc, id) {
  qc.invalidateQueries({ queryKey: ['briefings'] });
  if (id) qc.invalidateQueries({ queryKey: ['briefing', id] });
}

/** POST /api/briefings — create a day's briefing (server seeds the 8 sections). */
export function useCreateBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/briefings', { method: 'POST', body }).then((r) => r.briefing),
    onSuccess: (briefing) => {
      invalidateBriefings(qc, briefing?.id);
    },
  });
}

/** PATCH /api/briefings/:id — update title/status/scheduledFor. */
export function useUpdateBriefing(briefingId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id:string; body:Record<string,unknown> }) => api(`/briefings/${id}`, { method: 'PATCH', body }).then((r) => r.briefing),
    onSuccess: () => invalidateBriefings(qc, briefingId),
  });
}

/** DELETE /api/briefings/:id — only while the briefing is not_started/draft. */
export function useDeleteBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/briefings/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateBriefings(qc, undefined),
  });
}

// ── Section mutations ────────────────────────────────────────────────────────
// Each replaces the cached briefing's matching section with the fresh one the
// server returns, so the desk reflects the committed order/state immediately.

function replaceSection(qc, briefingId, section) {
  qc.setQueryData(['briefing', briefingId], (prev) => {
    if (!prev?.sections) return prev;
    return {
      ...prev,
      sections: prev.sections.map((s) => (s.id === section.id ? section : s)),
    };
  });
}

/**
 * Shared mutation body for every section write: call the endpoint, then commit
 * the fresh `{ section }` the server returns into the cached briefing (and
 * invalidate both the list and the detail).
 */
function buildSectionMutation(qc, { briefingId, functionId, method, path, bodyFrom }) {
  return {
    mutationFn: (vars: Record<string, unknown>) =>
      api(`/briefings/${briefingId}/sections/${functionId}${path(vars) ?? ''}`, {
        method,
        body: bodyFrom(vars),
      }).then((r) => r.section),
    onSuccess: (section) => {
      replaceSection(qc, briefingId, section);
      invalidateBriefings(qc, briefingId);
    },
  };
}

/** PATCH /api/briefings/:id/sections/:functionId — state/note/position. */
export function useUpdateSection(briefingId, functionId) {
  const qc = useQueryClient();
  return useMutation(
    buildSectionMutation(qc, {
      briefingId,
      functionId,
      method: 'PATCH',
      path: () => '',
      bodyFrom: ({ body }) => body,
    }),
  );
}

/** POST /api/briefings/:id/sections/:functionId/items — attach a publish item. */
export function useAttachItem(briefingId, functionId) {
  const qc = useQueryClient();
  return useMutation(
    buildSectionMutation(qc, {
      briefingId,
      functionId,
      method: 'POST',
      path: () => '/items',
      bodyFrom: ({ publishItemId }) => ({ publishItemId }),
    }),
  );
}

/** DELETE /api/briefings/:id/sections/:functionId/items/:itemId — detach a link. */
export function useDetachItem(briefingId, functionId) {
  const qc = useQueryClient();
  return useMutation(
    buildSectionMutation(qc, {
      briefingId,
      functionId,
      method: 'DELETE',
      path: ({ itemId }) => `/items/${itemId}`,
      bodyFrom: () => undefined,
    }),
  );
}

/** PATCH .../items/reorder — set the section's item order from the given ids. */
export function useReorderItems(briefingId, functionId) {
  const qc = useQueryClient();
  return useMutation(
    buildSectionMutation(qc, {
      briefingId,
      functionId,
      method: 'PATCH',
      path: () => '/items/reorder',
      bodyFrom: ({ itemIds }) => ({ itemIds }),
    }),
  );
}

// ── Supporting records (§05 events / §06 opportunities / §02 forum topics) ────

/** Factory for a supporting-record list query keyed by kind. */
function supportingListKey(kind) {
  return ['briefing-supporting', kind];
}

export function useSupportingEvents() {
  return useQuery({
    queryKey: supportingListKey('events'),
    queryFn: () => api('/briefings/supporting/events').then((r) => r.events ?? []),
    staleTime: 15_000,
  });
}

export function useSupportingOpportunities() {
  return useQuery({
    queryKey: supportingListKey('opportunities'),
    queryFn: () => api('/briefings/supporting/opportunities').then((r) => r.opportunities ?? []),
    staleTime: 15_000,
  });
}

export function useSupportingForumTopics() {
  return useQuery({
    queryKey: supportingListKey('forum-topics'),
    queryFn: () => api('/briefings/supporting/forum-topics').then((r) => r.forumTopics ?? []),
    staleTime: 15_000,
  });
}

/** Create a supporting record of the given kind (events|opportunities|forum-topics). */
export function useCreateSupporting(kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/briefings/supporting/${kind}`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supportingListKey(kind) });
      // Supporting counts ride on the briefing detail (§02/§05/§06).
      qc.invalidateQueries({ queryKey: ['briefings'] });
    },
  });
}

/** Delete a supporting record of the given kind. */
export function useDeleteSupporting(kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/briefings/supporting/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supportingListKey(kind) });
      qc.invalidateQueries({ queryKey: ['briefings'] });
    },
  });
}

// ── Available publish items (for "Attach existing") ──────────────────────────

/**
 * GET /api/publish?usableForDesk=true — editorial publish items available to
 * attach to a briefing section.
 *
 * The server applies the desk-eligibility rule (manually-authored items, plus
 * items whose linked inbox event was Accepted); the picker therefore only ever
 * offers items that are usable today. The serializer still does not expose
 * `contentType`, so the client presents what the endpoint returns (pillar,
 * status, body preview).
 */
export function useAvailablePublishItems({ limit = 50 } = {}) {
  return useQuery({
    queryKey: ['publish-items', { limit, usableForDesk: true }],
    queryFn: () =>
      api('/publish', { query: { limit, usableForDesk: true } }).then((r) => r.items ?? []),
    staleTime: 15_000,
  });
}
