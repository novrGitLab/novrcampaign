import starters from './starters.json';
import newsletterDark from './newsletter-dark.html?raw';
import newsletterLight from './newsletter-light.html?raw';
import newsletterMinimal from './newsletter-minimal.html?raw';
import newsletterOctoberWeek1 from './newsletter-october-week1.html?raw';
import newsletterOctoberWeek2 from './newsletter-october-week2.html?raw';
import pulseDailyBrief from './pulse-daily-brief.html?raw';
import pulseBreakingAlert from './pulse-breaking-alert.html?raw';
import pulseAnalystDeepDive from './pulse-analyst-deep-dive.html?raw';

const HTML_BY_FILE = {
  'newsletter-dark.html': newsletterDark,
  'newsletter-light.html': newsletterLight,
  'newsletter-minimal.html': newsletterMinimal,
  'newsletter-october-week1.html': newsletterOctoberWeek1,
  'newsletter-october-week2.html': newsletterOctoberWeek2,
  'pulse-daily-brief.html': pulseDailyBrief,
  'pulse-breaking-alert.html': pulseBreakingAlert,
  'pulse-analyst-deep-dive.html': pulseAnalystDeepDive,
};

/** Built-in CyberNovr newsletter starters: metadata + ready-to-save HTML. */
export const STARTER_TEMPLATES = starters.map((s) => ({ ...s, body: HTML_BY_FILE[s.file] ?? '' }));

export default STARTER_TEMPLATES;
