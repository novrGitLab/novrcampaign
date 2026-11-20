import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/campaigns', { method: 'POST', body }).then((r) => r.campaign),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => {
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
    mutationFn: (id) => api(`/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledFor }) =>
      api(`/campaigns/${id}/send`, { method: 'POST', body: scheduledFor ? { scheduledFor } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useScheduleCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledFor }) => {
      if (!id) throw new Error('Save the draft first — there is no campaign to schedule yet.');
      return api(`/campaigns/${id}/schedule`, { method: 'POST', body: { scheduledFor } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/campaigns/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useTestCampaign() {
  return useMutation({
    mutationFn: ({ id, email }) => {
      if (!id) throw new Error('Save the draft first — there is no campaign to test yet.');
      return api(`/campaigns/${id}/test`, { method: 'POST', body: { email } });
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/contacts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, checkMx = true }) => {
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
    mutationFn: (id) => api(`/campaigns/${id}/resend-unsent`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['segments'] });
    },
  });
}

export function useDuplicateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/campaigns/${id}/duplicate`, { method: 'POST' }).then((r) => r.campaign),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/templates', { method: 'POST', body }).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDuplicateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/templates/${id}/duplicate`, { method: 'POST' }).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useCreateSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/segments', { method: 'POST', body }).then((r) => r.segment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segments'] }),
  });
}

export function useDeleteSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/segments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segments'] }),
  });
}

export function useSegmentMembers(id) {
  const qc = useQueryClient();
  return {
    add: useMutation({
      mutationFn: (body) => api(`/segments/${id}/members`, { method: 'POST', body }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['segment-contacts', id] });
        qc.invalidateQueries({ queryKey: ['segment', id] });
      },
    }),
    remove: useMutation({
      mutationFn: (emails) => api(`/segments/${id}/members`, { method: 'DELETE', body: { emails } }),
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
    mutationFn: ({ action, ids }) => api(`/contacts/bulk-${action}`, { method: 'POST', body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

// ── Feed ─────────────────────────────────────────────────────────────────────

export function useCreateFeedEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api('/feed', { method: 'POST', body }).then((r) => r.entry),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useUpdateFeedEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => api(`/feed/${id}`, { method: 'PUT', body }).then((r) => r.entry),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useDeleteFeedEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/feed/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export function useInsertFeedEntry(campaignId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId) =>
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
}

/** POST /api/publish/f7 — project eligible F7 events into draft items.
 *  Dry-run unless `commit: true` (matches `projectSchema` in the controller). */
export function useProjectF7() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body = {}) => api('/publish/f7', { method: 'POST', body }),
    onSuccess: () => invalidatePulse(qc),
  });
}

export function useApprovePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/publish/${id}/approve`, { method: 'POST' }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

export function useRejectPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api(`/publish/${id}/reject`, { method: 'POST' }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

export function useEditPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => api(`/publish/${id}`, { method: 'PATCH', body: { body } }).then((r) => r.item),
    onSuccess: () => invalidatePulse(qc),
  });
}

/** PATCH /api/pulse/events/:id/review — persist Accept/Dismiss ("new" | "accepted" | "dismissed").
 *  Optimistically patches the cached list, then invalidates on settle so the
 *  server's persisted value wins. Non-destructive: only the status is written. */
export function useReviewPulseEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) =>
      api(`/pulse/events/${id}/review`, { method: 'PATCH', body: { status } }).then((r) => r.event),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['pulse-events'] });
      const snapshots = qc.getQueriesData({ queryKey: ['pulse-events'] });
      qc.setQueriesData({ queryKey: ['pulse-events'] }, (prev) => {
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
