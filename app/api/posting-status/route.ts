import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

/**
 * Get posting status for the current user:
 * - Their daily count & limit
 * - Their queue size
 * - Their total posted
 */
export async function GET(req: Request) {
  const { user, errorResponse } = await withAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const supabase = getServiceClient();
    const today = new Date().toISOString().split("T")[0];

    // User's daily count
    const { data: dailyData } = await supabase
      .from("posting_daily_count")
      .select("count, last_post_at")
      .eq("date", today)
      .eq("user_id", user!.id)
      .single();

    // User's queue count
    const { count: queueCount } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("fb_status", "queued")
      .eq("queued_by", user!.id);

    // User's total posted (all time)
    const { count: postedCount } = await supabase
      .from("posting_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "posted")
      .eq("user_id", user!.id);

    return NextResponse.json({
      daily: {
        count: dailyData?.count || 0,
        limit: user!.daily_post_limit,
        lastPostAt: dailyData?.last_post_at || null,
      },
      queue: queueCount || 0,
      totalPosted: postedCount || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
