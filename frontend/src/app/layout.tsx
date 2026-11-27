import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ReadingPreferences } from '@/components/ui/ReadingPreferences';
import '../index.css';
import '../../public/press/theme.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL || 'https://pulse.cybernovr.com'),
  title: 'NovrPulse',
  icons: '/cybernovr-logo.png',
};
export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const dark = jar.get('pulse_theme')?.value === 'dark';
  return (
    <html lang="en" data-theme={dark ? 'dark' : 'light'} className={dark ? 'dark' : ''}>
      <body>
        {children}
        <ReadingPreferences initialConsent={jar.get('pulse_consent')?.value || ''} />
      </body>
    </html>
  );
}
