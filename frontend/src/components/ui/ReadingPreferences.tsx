'use client';
import { Sun, Moon } from './icons';
import { useEffect, useState } from 'react';
export function cookie(name: string) {
  return document.cookie
    .split('; ')
    .find((pair) => pair.startsWith(name + '='))
    ?.split('=')[1];
}
function write(name: string, value: string, age = 31536000) {
  document.cookie =
    name +
    '=' +
    value +
    '; Path=/; SameSite=Lax; Max-Age=' +
    age +
    (location.protocol === 'https:' ? '; Secure' : '');
}
export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  sessionStorage.setItem('pulse_theme', theme);
  if (cookie('pulse_consent') === 'accept') write('pulse_theme', theme);
  window.dispatchEvent(new Event('reading-theme'));
}
export function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains('dark'));
    sync();
    window.addEventListener('reading-theme', sync);
    return () => window.removeEventListener('reading-theme', sync);
  }, []);
  return (
    <button className="reading-toggle" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => applyTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
      <span>{dark ? 'Light' : 'Dark'} mode</span>
    </button>
  );
}
export function ReadingPreferences({ initialConsent }: { initialConsent: string }) {
  const [open, setOpen] = useState(!initialConsent);
  useEffect(() => {
    applyTheme(
      cookie('pulse_theme') ||
        sessionStorage.getItem('pulse_theme') ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    );
    const show = () => setOpen(true);
    window.addEventListener('reading-preferences', show);
    return () => window.removeEventListener('reading-preferences', show);
  }, []);
  function choose(value: string) {
    write('pulse_consent', value);
    if (value === 'accept') write('pulse_theme', document.documentElement.dataset.theme || 'light');
    else write('pulse_theme', '', 0);
    setOpen(false);
  }
  if (!open) return null;
  return (
    <aside className="cookie" aria-label="Cookie preferences">
      <p>
        <strong>Reading preferences</strong>
        <br />
        Save the selected reading theme on this device.
      </p>
      <button onClick={() => choose('accept')}>Accept cookies</button>
      <button data-consent="essential" onClick={() => choose('essential')}>
        Essential only
      </button>
    </aside>
  );
}
export function PreferencesButton() {
  return (
    <button className="text-link" onClick={() => window.dispatchEvent(new Event('reading-preferences'))}>
      Cookie preferences
    </button>
  );
}
