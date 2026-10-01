import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import api, { auth } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback(async ({ email, password }) => {
    const { user: u, token } = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    auth.setToken(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    auth.clearToken();
    setUser(null);
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const { user: u } = await api('/auth/me');
      setUser(u);
      return u;
    } catch {
      auth.clearToken();
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Resolve the session once on boot so the auth gate can render
  useEffect(() => {
    if (auth.getToken()) fetchMe();
    else setLoading(false);
  }, [fetchMe]);

  const value = useMemo(
    () => ({ user, loading, isAuthenticated: Boolean(user && auth.getToken()), login, logout, fetchMe }),
    [user, loading, login, logout, fetchMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export default useAuth;
