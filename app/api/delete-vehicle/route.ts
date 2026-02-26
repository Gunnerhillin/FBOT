import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

/**
 * Delete a single vehicle and its photos from Supabase Storage.
 */
export async function POST(req: Request) {
  const { user, errorResponse } = await withAdmin(req);
  if (errorResponse) return errorResponse;

  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Vehicle ID required" }, { status: 400 });
    }

    const svc = getServiceClient();

    // Get the vehicle to find its VIN (for photo cleanup)
    const { data: vehicle, error: fetchError } = await svc
      .from("vehicles")
      .select("id, vin, photos")
      .eq("id", id)
      .single();

    if (fetchError || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    // Delete photos from Supabase Storage if they exist
    if (vehicle.vin) {
      const vinLower = vehicle.vin.toLowerCase();
      const { data: files } = await svc.storage
        .from("vehicle-photos")
        .list(vinLower);

      if (files && files.length > 0) {
        const filePaths = files.map((f: any) => `${vinLower}/${f.name}`);
        await svc.storage.from("vehicle-photos").remove(filePaths);
        console.log(`Deleted ${filePaths.length} photos for VIN ${vehicle.vin}`);
      }
    }

    // Delete the vehicle record
    const { error: deleteError } = await svc
      .from("vehicles")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: `Delete failed: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete vehicle error:", error);
    return NextResponse.json(
      { error: `Delete failed: ${error.message}` },
      { status: 500 }
    );
  }
}
