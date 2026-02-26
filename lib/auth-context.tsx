"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "./supabase";
import type { UserProfile } from "./auth";

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  token: string | null;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  token: null,
  signOut: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setUser(null);
      setToken(null);
      setLoading(false);
      return;
    }

    setToken(session.access_token);

    // Query Supabase REST API directly with the user's JWT
    // This guarantees the auth header is sent (bypasses any JS client issues)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}&select=*`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
          setUser(rows[0] as UserProfile);
          setLoading(false);
          return;
        }
      }

      console.error("Profile fetch failed, status:", res.status);
    } catch (err) {
      console.error("Profile fetch error:", err);
    }

    // Fallback: if profile fetch fails, try the API route
    try {
      const apiRes = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (apiRes.ok) {
        const profile = await apiRes.json();
        setUser(profile as UserProfile);
        setLoading(false);
        return;
      }
    } catch {}

    // Last resort: user is logged in but we can't get their profile
    setUser(null);
    setLoading(false);
  };

  useEffect(() => {
    fetchProfile();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setToken(session.access_token);
        fetchProfile();
      } else {
        setUser(null);
        setToken(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setToken(null);
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        token,
        signOut: handleSignOut,
        refreshUser: fetchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
