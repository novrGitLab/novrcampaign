import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button, Card, CardContent, Input, Label } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login({ email, password });
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-brand-ink p-4"
      style={{
        backgroundImage:
          'radial-gradient(600px 300px at 15% 10%, rgba(68,81,162,0.35), transparent), radial-gradient(500px 280px at 85% 15%, rgba(102,47,142,0.30), transparent), radial-gradient(700px 350px at 50% 100%, rgba(235,32,39,0.12), transparent)',
      }}
    >
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/cybernovr-logo-white.png" alt="CyberNovr" className="h-10 w-auto" />
          <div className="mt-4 h-1 w-24 rounded-full bg-linear-to-r from-brand-blue via-brand-purple to-brand-red" />
        </div>

        <Card>
          <CardContent className="p-8">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-bold">NovrCampaign</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Internal email campaigns, powered by Plunk
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@cybernovr.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait…' : 'Log in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-white/40">
          Internal CyberNovr tool — no self-registration. Ask an admin for access.
        </p>
      </div>
    </div>
  );
}
