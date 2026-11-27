import type { ReactNode } from 'react';
import { ThemeButton } from './ui/ReadingPreferences';

export function StaffEntry({ children }: { children: ReactNode }) {
  return (
    <main className="staff-login">
      <div className="login-top">
        <a href="/" className="desk-brand" aria-label="NovrPulse homepage">
          Novr<i>Pulse</i>
        </a>
        <ThemeButton />
      </div>
      <div className="login-body">
        <div className="login-photo" role="img" aria-label="Network patch cables" />
        <section className="min-w-0">
          <p className="desk-kicker">Editorial desk</p>
          {children}
        </section>
      </div>
    </main>
  );
}
