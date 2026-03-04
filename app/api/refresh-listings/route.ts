import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

/**
 * Refresh all posted listings for the current user.
 * Resets fb_status to "queued" so the poster will delete the old FB listing
 * and re-post fresh. The poster's stale-listing logic handles the actual
 * Facebook deletion before re-posting.
 */
export async function POST(req: Request) {
  const { user, errorResponse } = await withAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const supabase = getServiceClient();

    // Find all posted vehicles for this user
    const { data: postedVehicles, error: fetchError } = await supabase
      .from("vehicles")
      .select("id")
      .eq("fb_status", "posted")
      .eq("queued_by", user!.id);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!postedVehicles || postedVehicles.length === 0) {
      return NextResponse.json({ error: "No posted listings to refresh" }, { status: 400 });
    }

    const vehicleIds = postedVehicles.map((v: any) => v.id);

    // Reset all posted vehicles to queued
    const { error: updateError } = await supabase
      .from("vehicles")
      .update({
        fb_status: "queued",
        fb_queued_at: new Date().toISOString(),
        fb_posted_at: null,
        fb_listing_url: null,
      })
      .in("id", vehicleIds);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Log the refresh action
    const logEntries = vehicleIds.map((id: number) => ({
      vehicle_id: id,
      action: "refresh_all",
      user_id: user!.id,
      details: `Refresh requested — will delete old listing and re-post`,
    }));

    await supabase.from("posting_log").insert(logEntries);

    return NextResponse.json({
      success: true,
      refreshed: vehicleIds.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
