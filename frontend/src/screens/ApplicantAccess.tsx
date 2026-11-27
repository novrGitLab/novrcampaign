'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import api from '@/lib/api';
import { roles, type AccessRequest } from '@/lib/staffAccess';

const headings = {
  NEW: 'Request access',
  PENDING: 'Awaiting review',
  APPROVED: 'Access granted',
  DECLINED: 'Request declined',
};
export default function ApplicantAccess() {
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function load(method = 'GET', signal?: AbortSignal) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/auth/access', { method, signal });
      if (!signal?.aborted) setRequest(result);
    } catch (err) {
      if (!signal?.aborted)
        setError(err instanceof Error ? err.message : 'Unable to load the access request.');
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load('GET', controller.signal);
    return () => controller.abort();
  }, []);
  return (
    <>
      <h1>
        {request ? headings[request.status] : 'Newsroom access'}
        <span>.</span>
      </h1>
      {request && <p className="mb-3 break-words font-semibold">{request.email}</p>}
      <div aria-live="polite">
        {request?.status === 'NEW' && (
          <p>Request a role from a newsroom administrator. Your decision will arrive by email.</p>
        )}
        {request?.status === 'PENDING' && (
          <p>Your request is with the newsroom administrators. A decision will arrive by email.</p>
        )}
        {request?.status === 'APPROVED' && (
          <p>
            Your {request.role ? roles[request.role].toLowerCase() : 'newsroom'} access is ready. Sign in
            again to open the desk.
          </p>
        )}
        {request?.status === 'DECLINED' && (
          <p>
            A newsroom administrator declined this request. Contact the editorial team to discuss the
            decision.
          </p>
        )}
        {!request && busy && <p>Checking access…</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {request?.status === 'NEW' && (
          <Button disabled={busy} onClick={() => load('POST')}>
            Request access
          </Button>
        )}
        {request?.status === 'PENDING' && (
          <Button variant="secondary" disabled={busy} onClick={() => load()}>
            Check status
          </Button>
        )}
        {((!request && !busy) || request?.status === 'APPROVED') && (
          <a className="btn-primary" href="/api/auth/oidc/start">
            Continue with Zoho
          </a>
        )}
      </div>
    </>
  );
}
