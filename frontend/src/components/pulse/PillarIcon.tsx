import {
  Scale, MessagesSquare, GraduationCap, ShieldCheck, CalendarDays, HeartHandshake, Newspaper, Bug,
} from '../ui/icons';
import { cn } from '../../lib/utils';

/**
 * The lucide glyph for a pillar (functionId 1–8). Used by the Inbox card
 * thumbnails and the radial Editorial Canvas so both screens agree on the
 * pillar identity visually. Unknown ids fall back to a neutral document glyph.
 */
const ICON_BY_FUNCTION = {
  1: Scale,            // Regulatory Impact
  2: MessagesSquare,   // Forum Topic of the Day
  3: GraduationCap,    // Public Education & Advocacy
  4: ShieldCheck,      // Cybersecurity Awareness
  5: CalendarDays,     // Events
  6: HeartHandshake,   // Outreach Initiatives
  7: Newspaper,        // Breaking News of the Day
  8: Bug,              // CyberIntel
};

export default function PillarIcon({ functionId, className }) {
  const Icon = ICON_BY_FUNCTION[functionId] ?? Scale;
  return <Icon className={cn('h-5 w-5', className)} aria-hidden="true" />;
}

export { ICON_BY_FUNCTION };
