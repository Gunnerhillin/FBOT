import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

/**
 * Queue ALL ready vehicles for the current user.
 * Only queues vehicles not already posted/queued by anyone.
 */
export async function POST(req: Request) {
  const { user, errorResponse } = await withAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const supabase = getServiceClient();

    // Find vehicles that are ready but not posted/queued
    const { data: vehicles, error: fetchError } = await supabase
      .from("vehicles")
      .select("id, photos, description_a, fb_status")
      .in("fb_status", ["not_posted", "failed"]);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const ready = (vehicles || []).filter(
      (v: any) => v.photos?.length > 0 && v.description_a
    );

    if (ready.length === 0) {
      return NextResponse.json({ success: true, queued: 0, message: "No vehicles ready to queue" });
    }

    const now = new Date().toISOString();
    const ids = ready.map((v: any) => v.id);

    const { error: updateError } = await supabase
      .from("vehicles")
      .update({
        fb_status: "queued",
        fb_queued_at: now,
        queued_by: user!.id,
      })
      .in("id", ids);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Log each with user
    const logEntries = ids.map((id: number) => ({
      vehicle_id: id,
      action: "queued",
      user_id: user!.id,
    }));
    await supabase.from("posting_log").insert(logEntries);

    return NextResponse.json({ success: true, queued: ready.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
