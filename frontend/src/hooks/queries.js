import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../lib/api';

// Plunk list endpoints return either a bare array or a paginated
// { data: [...], cursor, hasMore, total } object — normalize to an array.
export function toArray(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.data)) return v.data;
  if (Array.isArray(v?.contacts)) return v.contacts;
  return [];
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api('/campaigns').then((r) => toArray(r.campaigns ?? r.data)),
    staleTime: 30_000,
  });
}

export function useCampaign(id) {
  return useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api(`/campaigns/${id}`).then((r) => r.campaign),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCampaignStats(id, { refetch = false } = {}) {
  return useQuery({
    queryKey: ['campaign-stats', id],
    queryFn: () => api(`/campaigns/${id}/analytics`).then((r) => r.stats),
    enabled: Boolean(id),
    staleTime: refetch ? 0 : 60_000,
  });
}

// ── Contacts ─────────────────────────────────────────────────────────────────

/** @param {{limit?:number,cursor?:string,search?:string,subscribed?:boolean,sort?:string,dir?:string}} [options] */
export function useContacts({ limit = 25, cursor, search, subscribed, sort, dir } = {}) {
  return useQuery({
    queryKey: ['contacts', { limit, cursor, search, subscribed, sort, dir }],
    queryFn: () => api('/contacts', { query: { limit, cursor, search, subscribed, sort, dir } }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * Total number of contacts matching an optional subscription filter.
 * Plunk only reports `total` on the first page, so we ask for a single row.
 * @param {boolean} [subscribed] omit for every contact, true/false to filter
 */
export function useContactCount(subscribed) {
  return useQuery({
    queryKey: ['contacts', 'count', { subscribed }],
    queryFn: () => api('/contacts', { query: { limit: 1, subscribed } }).then((r) => r.total ?? 0),
    staleTime: 30_000,
  });
}

/**
 * Addresses Plunk will not mail, with the reason (hard bounce / spam complaint
 * / unsubscribe) and the campaign that triggered it.
 */
export function useSuppressions() {
  return useQuery({
    queryKey: ['suppressions'],
    queryFn: () => api('/contacts/suppressions'),
    staleTime: 30_000,
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api('/templates').then((r) => toArray(r.templates ?? r.data)),
    staleTime: 30_000,
  });
}

export function useTemplate(id) {
  return useQuery({
    queryKey: ['template', id],
    queryFn: () => api(`/templates/${id}`).then((r) => r.template),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

// ── Segments ─────────────────────────────────────────────────────────────────

export function useSegments() {
  return useQuery({
    queryKey: ['segments'],
    queryFn: () => api('/segments').then((r) => toArray(r.segments ?? r.data)),
    staleTime: 30_000,
  });
}

export function useSegment(id) {
  return useQuery({
    queryKey: ['segment', id],
    queryFn: () => api(`/segments/${id}`).then((r) => r.segment),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useSegmentContacts(id, { page = 1, pageSize = 25 } = {}) {
  return useQuery({
    queryKey: ['segment-contacts', id, { page, pageSize }],
    queryFn: () => api(`/segments/${id}/contacts`, { query: { page, pageSize } }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// ── Account / provider ───────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api('/auth/me'),
    staleTime: 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api('/health'),
    staleTime: 60_000,
    retry: 1,
  });
}

// ── Feed ─────────────────────────────────────────────────────────────────────

export function useFeedEntries({ weekStart, status, sourceType, q } = {}) {
  return useQuery({
    queryKey: ['feed', { weekStart, status, sourceType, q }],
    queryFn: () =>
      api('/feed', { query: { weekStart, status, sourceType, q } }).then((r) => ({
        entries: r.entries ?? [],
        week: r.week,
      })),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCampaignFeedEntries(campaignId) {
  return useQuery({
    queryKey: ['campaign-feed-entries', campaignId],
    queryFn: () => api(`/campaigns/${campaignId}/feed-entries`).then((r) => r.entries ?? []),
    enabled: Boolean(campaignId),
    staleTime: 15_000,
  });
}

// ── NovrPulse ────────────────────────────────────────────────────────────────

/**
 * The day's collected intel. The events API has no `date` param, so the caller
 * pages by `pageSize` and filters to a Lagos day client-side (see PulseToday);
 * `since` is still forwarded when given so the server can narrow the window.
 */
export function usePulseEvents(params = {}) {
  const { page, pageSize = 100, function: functionId, reviewStatus, q, since, region, language, cyber, isCybersecurity, isThreatIntel, isNigeriaRelated, cyberRegion } = params;
  return useQuery({
    queryKey: ['pulse-events', { page, pageSize, functionId, reviewStatus, q, since, region, language, cyber, isCybersecurity, isThreatIntel, isNigeriaRelated, cyberRegion }],
    queryFn: () =>
      api('/pulse/events', {
        query: { page, pageSize, function: functionId, reviewStatus, q, since, region, language, cyber, isCybersecurity, isThreatIntel, isNigeriaRelated, cyberRegion },
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** One event with its sources and entities, for the detail panel. */
export function usePulseEvent(id) {
  return useQuery({
    queryKey: ['pulse-event', id],
    queryFn: () => api(`/pulse/events/${id}`).then((r) => r.event),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

/**
 * The AI judgement review queue (`GET /api/ai-judgements`).
 *
 * Every AI decision (dedup, rewrite, recommend) is recorded and awaits a human
 * accept/reject. Defaults to `outcome: 'pending'` — the review queue. Returns
 * `{ judgements: [...] }` where each row carries the frozen `scenario` (what the
 * AI saw), the `decision`/`confidence`/`rationale` (its verdict), and a resolved
 * `subject` with the event titles.
 *
 * @param {{kind?: string, outcome?: string, limit?: number}} [params]
 */
export function useAiJudgements({ kind, outcome = 'pending', limit = 50 } = {}) {
  return useQuery({
    queryKey: ['ai-judgements', { kind, outcome, limit }],
    queryFn: () => api('/ai-judgements', { query: { kind, outcome, limit } }).then((r) => r.judgements ?? []),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/**
 * Publish items already created from a given inbox event (Editorial Canvas
 * "prior work" panel). Server-side filters compose: `contentType` narrows to
 * briefing items, `eventId` scopes to this event.
 */
export function usePublishItemsForEvent(eventId, { contentType = 'briefing' } = {}) {
  return useQuery({
    queryKey: ['publish', { eventId, contentType }],
    queryFn: () => api('/publish', { query: { eventId, contentType } }).then((r) => r.items ?? []),
    enabled: Boolean(eventId),
    staleTime: 15_000,
  });
}
