'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ThemeProvider } from '../hooks/useTheme';
import { Layout } from './Layout';
import { PulseKingfisher } from './ui/PulseKingfisher';

function Gate({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);
  if (!isAuthenticated)
    return (
      <main className="staff-loading flex items-center gap-3 p-8" role="status">
        <PulseKingfisher pose="flight" />
        {loading ? 'Opening the desk…' : 'Staff sign-in required.'}
      </main>
    );
  return <Layout>{children}</Layout>;
}
export function StaffPortal({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30000 },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <Gate>{children}</Gate>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
