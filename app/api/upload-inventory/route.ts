import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

function parseInventory(rawText: string) {
  const lines = rawText.split("\n");
  const vehicles: any[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (
      line.includes("Edit") ||
      line.includes("View Picture") ||
      line.includes("FEATURED")
    ) {
      continue;
    }

    const parts = line.split("\t").filter(Boolean);
    if (parts.length < 7) continue;

    const yearRaw = parts[0];
    const make = parts[1];
    const model = parts[2];
    const trim = parts[3];
    const vin = parts[4];
    const mileage = parts[5];
    const price = parts[7];

    const year =
      yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

    vehicles.push({
      year,
      make,
      model,
      trim,
      vin,
      mileage,
      price,
    });
  }

  return vehicles;
}

export async function POST(req: Request) {
  const { user, errorResponse } = await withAdmin(req);
  if (errorResponse) return errorResponse;

  try {
    const { rawText } = await req.json();

    if (!rawText) {
      return NextResponse.json(
        { error: "No inventory provided" },
        { status: 400 }
      );
    }

    const vehicles = parseInventory(rawText);

    if (vehicles.length === 0) {
      return NextResponse.json(
        { error: "No vehicles parsed" },
        { status: 400 }
      );
    }

    const svc = getServiceClient();
    const { error } = await svc
      .from("vehicles")
      .insert(vehicles);

    if (error) {
      console.error(error);
      return NextResponse.json(
        { error: "Database insert failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      inserted: vehicles.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
