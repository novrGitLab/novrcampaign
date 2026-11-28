'use client';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui';
import { PulseKingfisher } from '../ui/PulseKingfisher';

export function SubscriptionDialog({
  confirmed = false,
  onClose,
}: {
  confirmed?: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="subscription-dialog"
      aria-labelledby={id + 'title'}
      aria-describedby={id + 'desc'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="subscription-stamp">
        <PulseKingfisher pose={confirmed ? 'perched' : 'flight'} />
      </div>
      <p className="subscription-kicker">The Daily Brief</p>
      <h2 id={id + 'title'}>{confirmed ? 'You’re on the list.' : 'Check your inbox.'}</h2>
      <p id={id + 'desc'}>
        {confirmed
          ? 'Your subscription is confirmed. Look for the next edition in your inbox.'
          : 'Open the email from NovrPulse and confirm your address to receive the Daily Brief.'}
      </p>
      <Button type="button" onClick={onClose} autoFocus>
        Okay
      </Button>
    </dialog>,
    document.body,
  );
}
