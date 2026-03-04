import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "../../../../lib/auth";
import { getServiceClient } from "../../../../lib/supabase";

// GET: list all users with their stats
export async function GET(request: NextRequest) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  const svc = getServiceClient();

  // Get all profiles
  const { data: users, error } = await svc
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get today's posting counts per user
  const today = new Date().toISOString().split("T")[0];
  const { data: dailyCounts } = await svc
    .from("posting_daily_count")
    .select("user_id, count")
    .eq("date", today);

  // Get queue counts per user
  const { data: queuedVehicles } = await svc
    .from("vehicles")
    .select("queued_by")
    .eq("fb_status", "queued")
    .not("queued_by", "is", null);

  // Get total posted per user (all time)
  const { data: postLogs } = await svc
    .from("posting_log")
    .select("user_id")
    .eq("action", "posted")
    .not("user_id", "is", null);

  // Aggregate stats
  const stats = (users || []).map((u: any) => {
    const dailyCount = (dailyCounts || []).find((d: any) => d.user_id === u.id);
    const queued = (queuedVehicles || []).filter((v: any) => v.queued_by === u.id).length;
    const totalPosted = (postLogs || []).filter((l: any) => l.user_id === u.id).length;

    return {
      user_id: u.id,
      posted_today: dailyCount?.count || 0,
      queued,
      total_posted: totalPosted,
    };
  });

  return NextResponse.json({ users, stats });
}

// PATCH: update user settings (admin only)
export async function PATCH(request: NextRequest) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  const { userId, ...updates } = await request.json();

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Only allow specific fields to be updated
  const allowed: Record<string, any> = {};
  if (typeof updates.is_active === "boolean") allowed.is_active = updates.is_active;
  if (typeof updates.daily_post_limit === "number") allowed.daily_post_limit = updates.daily_post_limit;
  if (updates.role === "admin" || updates.role === "salesperson") allowed.role = updates.role;
  if (typeof updates.phone === "string") allowed.phone = updates.phone.trim() || null;
  if (typeof updates.display_name === "string") allowed.display_name = updates.display_name.trim() || null;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const svc = getServiceClient();
  const { error } = await svc
    .from("profiles")
    .update(allowed)
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
