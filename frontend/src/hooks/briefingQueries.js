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
export function useBriefings({ from, to, status } = {}) {
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
    mutationFn: (body) => api('/briefings', { method: 'POST', body }).then((r) => r.briefing),
    onSuccess: (briefing) => {
      invalidateBriefings(qc, briefing?.id);
    },
  });
}

/** PATCH /api/briefings/:id — update title/status/scheduledFor. */
export function useUpdateBriefing(briefingId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => api(`/briefings/${id}`, { method: 'PATCH', body }).then((r) => r.briefing),
    onSuccess: () => invalidateBriefings(qc, briefingId),
  });
}

/** DELETE /api/briefings/:id — only while the briefing is not_started/draft. */
export function useDeleteBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/briefings/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateBriefings(qc),
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
    mutationFn: (vars) =>
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

/** POST .../author — manually author a new publish item into the section. */
export function useAuthorItem(briefingId, functionId) {
  const qc = useQueryClient();
  return useMutation(
    buildSectionMutation(qc, {
      briefingId,
      functionId,
      method: 'POST',
      path: () => '/author',
      bodyFrom: ({ body }) => ({ body }),
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
    mutationFn: (body) => api(`/briefings/supporting/${kind}`, { method: 'POST', body }),
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
    mutationFn: (id) => api(`/briefings/supporting/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supportingListKey(kind) });
      qc.invalidateQueries({ queryKey: ['briefings'] });
    },
  });
}

// ── Available publish items (for "Attach existing") ──────────────────────────

/**
 * GET /api/publish — editorial publish items available to attach.
 *
 * NOTE: the publish serializer does not currently expose `contentType`, so the
 * list cannot be filtered to `contentType='briefing'` client-side; the desk
 * presents every item the endpoint returns and shows what it carries (pillar,
 * status, body preview). See the deferred note in the deliverable.
 */
export function useAvailablePublishItems({ limit = 50 } = {}) {
  return useQuery({
    queryKey: ['publish-items', { limit }],
    queryFn: () => api('/publish', { query: { limit } }).then((r) => r.items ?? []),
    staleTime: 15_000,
  });
}
