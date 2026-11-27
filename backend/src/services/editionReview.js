import { PILLARS } from './novrpulse/pillars.js';
export { mediaUrl } from './newsroomPhoto.js';
export function completeEdition(sections = []) {
  return PILLARS.every(({ functionId }) => {
    const section = sections.find((s) => s.functionId === functionId);
    if (!section) return false;
    return section.items.length ? section.state === 'ready' : section.state === 'no_updates';
  });
}
