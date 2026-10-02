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
