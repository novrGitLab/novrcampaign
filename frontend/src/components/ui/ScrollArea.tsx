import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';

export function ScrollArea({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; scroll: number } | null>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0 });
  useEffect(() => {
    const view = viewport.current,
      inner = content.current;
    if (!view || !inner) return;
    const sync = () => {
      const max = view.scrollHeight - view.clientHeight;
      const height =
        max > 1
          ? Math.min(view.clientHeight - 1, Math.max(24, view.clientHeight ** 2 / view.scrollHeight))
          : 0;
      setThumb({ height, top: max > 0 ? ((view.clientHeight - height) * view.scrollTop) / max : 0 });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(view);
    observer.observe(inner);
    view.addEventListener('scroll', sync, { passive: true });
    sync();
    return () => {
      observer.disconnect();
      view.removeEventListener('scroll', sync);
    };
  }, []);
  function start(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !viewport.current) return;
    const view = viewport.current,
      track = e.currentTarget;
    if (e.target === track) {
      const position = e.clientY - track.getBoundingClientRect().top - thumb.height / 2;
      view.scrollTop =
        (position * (view.scrollHeight - view.clientHeight)) / (view.clientHeight - thumb.height);
    }
    drag.current = { y: e.clientY, scroll: view.scrollTop };
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const view = viewport.current;
    if (!drag.current || !view) return;
    view.scrollTop =
      drag.current.scroll +
      ((e.clientY - drag.current.y) * (view.scrollHeight - view.clientHeight)) /
        Math.max(1, view.clientHeight - thumb.height);
  }
  return (
    <div className={'scroll-area ' + className}>
      <div ref={viewport} className="scroll-content" tabIndex={0} aria-label={label} role="region">
        <div ref={content}>{children}</div>
      </div>
      {thumb.height > 0 && (
        <div
          className="scroll-track"
          aria-hidden="true"
          onPointerDown={start}
          onPointerMove={move}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <span style={{ height: thumb.height, transform: 'translateY(' + thumb.top + 'px)' }} />
        </div>
      )}
    </div>
  );
}
