import { ThemeButton } from '@/components/ui/ReadingPreferences';
export const metadata = { title: 'Staff sign-in | NovrPulse', robots: { index: false, follow: false } };
export default async function Login({ searchParams }: { searchParams: Promise<{ sso?: string }> }) {
  const { sso } = await searchParams;
  return (
    <main className="staff-login">
      <div className="login-top">
        <a href="/" className="desk-brand">
          Novr<i>Pulse</i>
        </a>
        <ThemeButton />
      </div>
      <div className="login-body">
        <div className="login-photo" role="img" aria-label="Network patch cables" />
        <section>
          <p className="desk-kicker">Editorial desk</p>
          <h1>
            Staff sign-in<span>.</span>
          </h1>
          <p>Use a CyberNovr staff account to open the newsroom.</p>
          {sso && (
            <p role="alert">
              {sso === 'unavailable'
                ? 'Staff sign-in is temporarily unavailable.'
                : 'Sign-in could not be completed. Check that this account has newsroom access.'}
            </p>
          )}
          <a className="login-link" href="/api/auth/oidc/start">
            Continue with Zoho <span aria-hidden="true">↗</span>
          </a>
        </section>
      </div>
    </main>
  );
}
