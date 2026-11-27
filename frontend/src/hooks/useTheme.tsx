import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { applyTheme } from '../components/ui/ReadingPreferences';
const ThemeContext=createContext({theme:'light',isDark:false,toggle:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}){
  const [theme,setTheme]=useState('light');
  useEffect(()=>{const sync=()=>setTheme(document.documentElement.dataset.theme || 'light');sync();window.addEventListener('reading-theme',sync);return()=>window.removeEventListener('reading-theme',sync);},[]);
  return <ThemeContext.Provider value={{theme,isDark:theme==='dark',toggle:()=>applyTheme(theme==='dark'?'light':'dark')}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);
export default useTheme;
