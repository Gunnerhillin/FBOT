import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

/**
 * Remove a vehicle from the posting queue.
 * Users can only unqueue their own vehicles (admins can unqueue any).
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

    // Get the vehicle to check ownership
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, queued_by, fb_status")
      .eq("id", vehicleId)
      .single();

    if (!vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    // Non-admins can only unqueue their own
    if (user!.role !== "admin" && vehicle.queued_by !== user!.id) {
      return NextResponse.json({ error: "You can only remove your own queued vehicles" }, { status: 403 });
    }

    const { error } = await supabase
      .from("vehicles")
      .update({
        fb_status: "not_posted",
        fb_queued_at: null,
        queued_by: null,
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
