'use client';
import { usePathname } from 'next/navigation';
import { ThemeButton } from '../ui/ReadingPreferences';
const links = [
  ['/', 'Front page'],
  ['/edition/nigeria', 'Nigeria'],
  ['/edition/africa', 'Africa'],
  ['/edition/world', 'World'],
];
export function RegionNav() {
  const path = usePathname();
  return (
    <nav className="desk-nav" aria-label="Editions">
      <div>
        {links.map(([href, label]) => (
          <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </div>
      <ThemeButton />
    </nav>
  );
}
