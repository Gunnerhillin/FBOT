import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Queue ALL ready vehicles (have photos + description, not already posted/queued).
 */
export async function POST() {
  try {
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
      return NextResponse.json({
        success: true,
        queued: 0,
        message: "No vehicles ready to queue",
      });
    }

    const now = new Date().toISOString();
    const ids = ready.map((v: any) => v.id);

    const { error: updateError } = await supabase
      .from("vehicles")
      .update({ fb_status: "queued", fb_queued_at: now })
      .in("id", ids);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Log each
    const logEntries = ids.map((id: number) => ({
      vehicle_id: id,
      action: "queued",
    }));
    await supabase.from("posting_log").insert(logEntries);

    return NextResponse.json({
      success: true,
      queued: ready.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
