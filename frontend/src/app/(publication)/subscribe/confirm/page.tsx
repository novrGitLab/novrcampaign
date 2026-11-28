'use client';
import { SubscriptionDialog } from '@/components/public/SubscriptionDialog';
import { Button } from '@/components/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
export default function Confirm() {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [token, setToken] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const fragment = location.hash.slice(1);
    if (fragment) {
      setToken(fragment);
      history.replaceState(null, '', location.pathname);
    }
  }, []);
  async function confirm() {
    setBusy(true);
    try {
      const r = await fetch('/api/public/subscribe/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: token }),
      });
      setStatus(
        r.ok
          ? 'Subscription confirmed.'
          : r.status === 400
            ? 'This link has expired. Request a new email below.'
            : 'Confirmation unavailable. Please try again.',
      );
      if (r.ok) {
        setToken('');
        setConfirmed(true);
        setStatus('');
      }
    } catch {
      setStatus('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="notice">
      <h1>Confirm subscription.</h1>
      <Button disabled={!token || busy} onClick={confirm}>
        Subscribe to the Daily Brief
      </Button>
      {confirmed && (
        <SubscriptionDialog
          confirmed
          onClose={() => {
            setConfirmed(false);
            router.replace('/');
          }}
        />
      )}
      <p role="status">{status}</p>
    </section>
  );
}
