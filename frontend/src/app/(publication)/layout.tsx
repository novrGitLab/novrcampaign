import type { ReactNode } from 'react';
import { newsDate } from '@/lib/news';
import { Newsletter } from '@/components/public/Newsletter';
import { PreferencesButton } from '@/components/ui/ReadingPreferences';
import { RegionNav } from '@/components/public/RegionNav';
import '../../../public/press/edition.css';
export default function Publication({ children }: { children: ReactNode }) {
  return (
    <div className="newspaper">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="topline">
        <span>
          CYBERNOVR <b>/</b> JOURNAL
        </span>
        <time>{newsDate(new Date(), true)}</time>
      </div>
      <header className="mast">
        <a href="/" aria-label="NovrPulse front page">
          <span className="wordmark">
            Novr<i>Pulse</i>
          </span>
        </a>
        <p>
          Cybersecurity reporting
          <br />
          from Nigeria and beyond.
        </p>
        <a className="subscribe-link" href="#newsletter">
          Get the briefing
        </a>
      </header>
      <RegionNav />
      <main id="main">{children}</main>
      <footer id="newsletter">
        <div className="footer-inner">
          <div>
            <p className="eyebrow">The newsletter</p>
            <h2>
              The Daily <i>Brief.</i>
            </h2>
            <p>Cybersecurity headlines, context and practical advice, delivered by email.</p>
          </div>
          <Newsletter />
        </div>
        <div className="colophon">
          <b>NovrPulse</b>
          <span>A CyberNovr publication</span>
          <a href="mailto:info@cybernovr.com">Contact the desk</a>
          <PreferencesButton />
        </div>
      </footer>
    </div>
  );
}
