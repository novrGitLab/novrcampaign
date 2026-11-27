import { useEffect, useRef } from 'react';
import { X } from './icons';
import { cn } from '../../lib/utils';

/**
 * Minimal modal (no dependency on a headless-ui primitive).
 * @param {{ open: boolean, onClose: () => void, title?: string, description?: string, children: React.ReactNode, className?: string }} props
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return undefined;

    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex=\"0\"]',
        ) || [],
      ).filter((el) => el.getClientRects().length);
    (focusable()[0] || dialog.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1);
        if (
          (e.shiftKey && document.activeElement === first) ||
          (!e.shiftKey && document.activeElement === last)
        ) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative mx-auto my-8 w-full max-w-lg rounded-xl border border-border bg-card shadow-lg',
          className,
        )}
      >
        <div className="flex items-start justify-between p-6 pb-0">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default Modal;
