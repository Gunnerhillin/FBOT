import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get current posting status: daily count, queue size, recent activity.
 */
export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Daily count
    const { data: dailyData } = await supabase
      .from("posting_daily_count")
      .select("count, last_post_at")
      .eq("date", today)
      .single();

    // Queue count
    const { count: queueCount } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("fb_status", "queued");

    // Posted count (all time)
    const { count: postedCount } = await supabase
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("fb_status", "posted");

    // Recent log entries
    const { data: recentLog } = await supabase
      .from("posting_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      daily: {
        count: dailyData?.count || 0,
        limit: 10,
        lastPostAt: dailyData?.last_post_at || null,
      },
      queue: queueCount || 0,
      totalPosted: postedCount || 0,
      recentLog: recentLog || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
