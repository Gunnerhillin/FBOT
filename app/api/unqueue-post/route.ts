import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Remove a vehicle from the posting queue.
 * Resets fb_status back to 'not_posted'.
 */
export async function POST(req: Request) {
  try {
    const { vehicleId } = await req.json();

    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("vehicles")
      .update({
        fb_status: "not_posted",
        fb_queued_at: null,
      })
      .eq("id", vehicleId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
