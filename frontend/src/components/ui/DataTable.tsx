import { Button } from './index';
import { ChevronLeft, ChevronRight } from './icons';
import type { ReactNode } from 'react';
export function DataTable({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="w-full overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table aria-label={label} className="table">
        {children}
      </table>
    </div>
  );
}
export function Pagination({
  previous,
  next,
  canPrevious,
  canNext,
  label,
}: {
  previous: () => void;
  next: () => void;
  canPrevious: boolean;
  canNext: boolean;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" disabled={!canPrevious} onClick={previous}>
        <ChevronLeft className="size-4" />
        Previous
      </Button>
      <Button variant="secondary" size="sm" disabled={!canNext} onClick={next}>
        Next
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.key}
          size="sm"
          variant={value === option.key ? 'primary' : 'secondary'}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
