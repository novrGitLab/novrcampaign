import ApplicantAccess from '@/screens/ApplicantAccess';
import { StaffEntry } from '@/components/StaffEntry';
export const metadata = { title: 'Newsroom access | NovrPulse', robots: { index: false, follow: false } };
export default function AccessRequestPage() {
  return (
    <StaffEntry>
      <ApplicantAccess />
    </StaffEntry>
  );
}
