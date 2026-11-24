/**
 * The newsroom pipeline stepper — the orientation rail shared by all three
 * revamped screens: The Wire (①), Write (②), The Front Page (③).
 *
 * Purely presentational. Each screen passes its own `active` stage so the same
 * ① ② ③ vocabulary and styling reads consistently across the flow. It is not a
 * control (no navigation): it orients the editor in the pipeline.
 */

const STEPS = [
  { key: 'wire', n: '①', label: 'The Wire' },
  { key: 'write', n: '②', label: 'Write' },
  { key: 'front', n: '③', label: 'The Front Page' },
];

export default function PipelineStepper({ active }) {
  return (
    <div className="flex items-center gap-1.5" aria-label="Pipeline: The Wire, Write, The Front Page">
      {STEPS.map((s, i) => {
        const isActive = s.key === active;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-4 bg-[color:var(--pulse-border-hi)]" aria-hidden="true" />}
            <span
              aria-current={isActive ? 'step' : undefined}
              className={
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors ' +
                (isActive
                  ? 'border-[#2c5aa8] bg-[color:var(--pulse-accent-dim)] text-white'
                  : 'border-transparent text-muted-foreground')
              }
            >
              <span
                className={
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px] ' +
                  (isActive ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground')
                }
              >
                {s.n}
              </span>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
