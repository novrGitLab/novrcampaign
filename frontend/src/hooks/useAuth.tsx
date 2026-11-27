import { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';

interface StaffUser { id:string; email:string; name?:string; role:'ADMIN'|'SENDER'|'VIEWER' }
const AuthContext = createContext<{user:StaffUser|null;loading:boolean;isAuthenticated:boolean;logout:()=>Promise<void>}|null>(null);
export function AuthProvider({ children }: {children:React.ReactNode}) {
  const [user, setUser] = useState<StaffUser|null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api('/auth/me').then(data => { if (active) setUser(data.user); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    const expired = () => setUser(null);
    window.addEventListener('pulse-session-expired', expired);
    return () => { active = false; window.removeEventListener('pulse-session-expired', expired); };
  }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, isAuthenticated: Boolean(user), logout }}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('Staff context required');return value;}
export default useAuth;
