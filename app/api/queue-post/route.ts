import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

/**
 * Queue a vehicle for Facebook Marketplace posting.
 * Sets fb_status = 'queued' and records the queue time + user.
 */
export async function POST(req: Request) {
  const { user, errorResponse } = await withAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const { vehicleId } = await req.json();
    const supabase = getServiceClient();

    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId required" }, { status: 400 });
    }

    // Get vehicle to verify it exists and is ready
    const { data: vehicle, error: fetchError } = await supabase
      .from("vehicles")
      .select("id, vin, photos, description_a, fb_status, queued_by")
      .eq("id", vehicleId)
      .single();

    if (fetchError || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    if (vehicle.fb_status === "posted") {
      return NextResponse.json({ error: "Already posted" }, { status: 400 });
    }
    if (vehicle.fb_status === "queued") {
      return NextResponse.json({ error: "Already in queue" }, { status: 400 });
    }

    if (!vehicle.photos || vehicle.photos.length === 0) {
      return NextResponse.json({ error: "Vehicle needs photos first" }, { status: 400 });
    }
    if (!vehicle.description_a) {
      return NextResponse.json({ error: "Vehicle needs a description first" }, { status: 400 });
    }

    // Queue it with user assignment
    const { error: updateError } = await supabase
      .from("vehicles")
      .update({
        fb_status: "queued",
        fb_queued_at: new Date().toISOString(),
        queued_by: user!.id,
      })
      .eq("id", vehicleId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Log the action with user
    await supabase.from("posting_log").insert({
      vehicle_id: vehicleId,
      action: "queued",
      user_id: user!.id,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
