import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Minimal modal (no dependency on a headless-ui primitive).
 * @param {{ open: boolean, onClose: () => void, title?: string, description?: string, children: React.ReactNode, className?: string }} props
 */
export function Modal({ open, onClose, title, description, children, className }) {
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    /* Backdrop IS the scroll container: its background always covers the full
       scroll height, and plain margins (no flex centering) keep tall dialogs
       reachable top and bottom with zero clipping edge cases. */
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative mx-auto my-8 w-full max-w-lg rounded-lg border bg-card shadow-lg',
          className,
        )}
      >
        <div className="flex items-start justify-between p-6 pb-0">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
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
