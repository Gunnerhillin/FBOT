import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Queue a vehicle for Facebook Marketplace posting.
 * Sets fb_status = 'queued' and records the queue time.
 */
export async function POST(req: Request) {
  try {
    const { vehicleId } = await req.json();

    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId required" }, { status: 400 });
    }

    // Get vehicle to verify it exists and is ready
    const { data: vehicle, error: fetchError } = await supabase
      .from("vehicles")
      .select("id, vin, photos, description_a, fb_status")
      .eq("id", vehicleId)
      .single();

    if (fetchError || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    // Check if already posted or queued
    if (vehicle.fb_status === "posted") {
      return NextResponse.json({ error: "Already posted" }, { status: 400 });
    }
    if (vehicle.fb_status === "queued") {
      return NextResponse.json({ error: "Already in queue" }, { status: 400 });
    }

    // Check readiness (needs photos + description)
    if (!vehicle.photos || vehicle.photos.length === 0) {
      return NextResponse.json(
        { error: "Vehicle needs photos first" },
        { status: 400 }
      );
    }
    if (!vehicle.description_a) {
      return NextResponse.json(
        { error: "Vehicle needs a description first" },
        { status: 400 }
      );
    }

    // Queue it
    const { error: updateError } = await supabase
      .from("vehicles")
      .update({
        fb_status: "queued",
        fb_queued_at: new Date().toISOString(),
      })
      .eq("id", vehicleId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Log the action
    await supabase.from("posting_log").insert({
      vehicle_id: vehicleId,
      action: "queued",
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
