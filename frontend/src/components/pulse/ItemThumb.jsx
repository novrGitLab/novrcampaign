import PillarIcon from './PillarIcon';
import { cn } from '../../lib/utils';

/**
 * Thumbnail placeholder for a pulse card/event card. This is deliberately NOT a
 * publisher image — it is a brand-tinted pillar glyph tile, so the inbox never
 * pulls third-party assets. Square + rounded so it aligns in a fixed column.
 */
export default function ItemThumb({ functionId, className }) {
  return (
    <span
      className={cn(
        'flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-border bg-brand-purple/10 text-brand-purple',
        className,
      )}
      aria-hidden="true"
    >
      <PillarIcon functionId={functionId} className="h-8 w-8" />
    </span>
  );
}
