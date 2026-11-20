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
 * pages by `pageSize` and filters to a Lagos day client-side (see PulseReview);
 * `since` is still forwarded when given so the server can narrow the window.
 */
export function usePulseEvents(params = {}) {
  const { page, pageSize = 100, function: functionId, reviewStatus, q, since, region } = params;
  return useQuery({
    queryKey: ['pulse-events', { page, pageSize, functionId, reviewStatus, q, since, region }],
    queryFn: () =>
      api('/pulse/events', {
        query: { page, pageSize, function: functionId, reviewStatus, q, since, region },
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
