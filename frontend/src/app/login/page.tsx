import { StaffEntry } from '@/components/StaffEntry';
export const metadata = { title: 'Staff sign-in | NovrPulse', robots: { index: false, follow: false } };
export default async function Login({ searchParams }: { searchParams: Promise<{ sso?: string }> }) {
  const { sso } = await searchParams;
  return (
    <StaffEntry>
      <h1>
        Staff sign-in<span>.</span>
      </h1>
      <p>Sign in with your CyberNovr account. First-time visitors can request newsroom access.</p>
      {sso && (
        <p role="alert">
          {sso === 'unavailable'
            ? 'Staff sign-in is temporarily unavailable.'
            : 'Sign-in could not be completed. Check that this account has newsroom access.'}
        </p>
      )}
      <a className="login-link" href="/api/auth/oidc/start">
        Continue with Zoho
      </a>
    </StaffEntry>
  );
}
