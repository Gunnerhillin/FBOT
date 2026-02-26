import { supabase, getServiceClient } from "./supabase";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "salesperson";
  daily_post_limit: number;
  is_active: boolean;
  created_at: string;
}

// ── Browser-side helpers ──

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  const session = await getSession();
  if (!session) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();

  return data as UserProfile | null;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ── Server-side helpers (API routes) ──

export async function getServerUser(request: Request): Promise<UserProfile | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "");
  const svc = getServiceClient();

  const { data: { user }, error } = await svc.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await svc
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile as UserProfile | null;
}

export function requireAuth(user: UserProfile | null): UserProfile {
  if (!user) throw new Error("Unauthorized");
  if (!user.is_active) throw new Error("Account disabled");
  return user;
}

export function requireAdmin(user: UserProfile | null): UserProfile {
  const u = requireAuth(user);
  if (u.role !== "admin") throw new Error("Admin access required");
  return u;
}

// Helper for API routes to extract auth and return error responses
export async function withAuth(request: Request): Promise<{ user: UserProfile | null; errorResponse: Response | null }> {
  const user = await getServerUser(request);
  if (!user || !user.is_active) {
    return {
      user: null,
      errorResponse: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user, errorResponse: null };
}

export async function withAdmin(request: Request): Promise<{ user: UserProfile | null; errorResponse: Response | null }> {
  const { user, errorResponse } = await withAuth(request);
  if (errorResponse) return { user: null, errorResponse };
  if (user!.role !== "admin") {
    return {
      user: null,
      errorResponse: Response.json({ error: "Admin access required" }, { status: 403 }),
    };
  }
  return { user, errorResponse: null };
}
