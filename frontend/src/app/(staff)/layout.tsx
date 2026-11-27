import type { ReactNode } from 'react';
import { StaffPortal } from '@/components/StaffPortal';
export const metadata = { robots: { index: false, follow: false }, title: 'Editorial desk | NovrPulse' };
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffPortal>{children}</StaffPortal>;
}
