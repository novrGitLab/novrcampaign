'use client';
import { Button } from '@/components/ui';
export default function PublicationError({ reset }: { reset: () => void }) {
  return (
    <section className="notice">
      <h1>Coverage is temporarily unavailable.</h1>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
