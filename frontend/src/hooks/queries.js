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

export function useContacts({ limit = 25, cursor, search } = {}) {
  return useQuery({
    queryKey: ['contacts', { limit, cursor, search }],
    queryFn: () => api('/contacts', { query: { limit, cursor, search } }),
    placeholderData: keepPreviousData,
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
