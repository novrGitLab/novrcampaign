'use client';
import { useState, type FormEvent } from 'react';
import { SubscriptionDialog } from './SubscriptionDialog';
import { Button, Input, Label } from '../ui';
export function Newsletter() {
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/public/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.ok) setSubmitted(true);
      else
        setMessage(
          response.status === 429
            ? 'Please try again later.'
            : 'Subscription unavailable. Please try again later.',
        );
    } catch {
      setMessage('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <Label htmlFor="subscriber">Email address</Label>
      <div className="signup">
        <Input
          id="subscriber"
          name="email"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
          maxLength={254}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Subscribing…' : 'Subscribe'}
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      {submitted && <SubscriptionDialog onClose={() => setSubmitted(false)} />}
    </form>
  );
}
