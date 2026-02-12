export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import pdfParse from "pdf-parse";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Parse vAuto "Pricing (Default)" PDF text into vehicle records.
 */
function parseVAutoText(fullText: string) {
  const lines = fullText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const vehicles: any[] = [];
  let current: any = null;

  const flushCurrent = () => {
    if (current && current.year && current.make) {
      vehicles.push({ ...current });
    }
    current = null;
  };

  const isHeaderFooter = (line: string) => {
    return (
      line.startsWith("Make/Model") ||
      line.startsWith("Pricing (Default)") ||
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/.test(line) ||
      line.includes("vAuto, Inc.") ||
      line.includes("http://www.vauto.com") ||
      line.includes("(877) 828-8614") ||
      /^Page \d+ of \d+$/.test(line)
    );
  };

  for (const line of lines) {
    if (isHeaderFooter(line)) continue;

    const vehicleNameMatch = line.match(/^(\d{4})\s+([A-Z][a-zA-Z].*)/);
    if (
      vehicleNameMatch &&
      !line.includes("Body:") &&
      !line.startsWith("$") &&
      !line.includes("Stock") &&
      !line.includes("VIN:") &&
      !line.includes("Color:") &&
      !line.includes("Class:")
    ) {
      flushCurrent();

      const year = vehicleNameMatch[1];
      let nameRaw = vehicleNameMatch[2].trim();

      let inlinePrice = "";
      const inlinePriceMatch = nameRaw.match(/\s+\$([0-9,]+)\s*$/);
      if (inlinePriceMatch) {
        inlinePrice = inlinePriceMatch[1].replace(/,/g, "");
        nameRaw = nameRaw.replace(/\s+\$[0-9,]+\s*$/, "").trim();
      }

      const nameParts = nameRaw.split(/\s+/);
      const make = nameParts[0];
      const model = nameParts.slice(1).join(" ");

      current = {
        year,
        make,
        model,
        trim: "",
        vin: "",
        stock_number: "",
        price: inlinePrice,
        mileage: "",
        body: "",
        color: "",
        vehicle_class: "",
        recall_status: "",
        disposition: "",
      };
      continue;
    }

    if (!current) continue;

    const priceMatch = line.match(/^\$([0-9,]+)/);
    if (priceMatch) {
      current.price = priceMatch[1].replace(/,/g, "");
      continue;
    }

    // Body line with mileage: "Body: 4D Sport Utility 2/7/2026 99,377"
    const bodyMatch = line.match(
      /Body:\s+(.+?)\s+(?:(\d{1,2}\/\d{1,2}\/\d{4})\s+)?([0-9,]+)\s*$/
    );
    if (bodyMatch) {
      current.body = bodyMatch[1].trim();
      current.mileage = bodyMatch[3].replace(/,/g, "");
      continue;
    }
    // Body without mileage
    const bodySimple = line.match(/Body:\s+(.+)/);
    if (bodySimple && !bodyMatch) {
      current.body = bodySimple[1].trim();
      continue;
    }

    // Standalone mileage line: just a number like "99,377" or "99377"
    // (pdf-parse sometimes puts mileage on its own line)
    if (!current.mileage && /^[0-9,]+$/.test(line)) {
      const num = parseInt(line.replace(/,/g, ""), 10);
      // Only treat as mileage if it's a reasonable mileage value (100 - 999,999)
      if (num >= 100 && num <= 999999) {
        current.mileage = String(num);
        continue;
      }
    }

    // Mileage with date prefix: "2/7/2026 99,377"
    const dateMileageMatch = line.match(
      /^(\d{1,2}\/\d{1,2}\/\d{4})\s+([0-9,]+)$/
    );
    if (dateMileageMatch && !current.mileage) {
      current.mileage = dateMileageMatch[2].replace(/,/g, "");
      continue;
    }

    // Explicit "Mileage:" or "Miles:" label
    const mileageLabel = line.match(/(?:Mileage|Miles|Odometer):\s*([0-9,]+)/i);
    if (mileageLabel) {
      current.mileage = mileageLabel[1].replace(/,/g, "");
      continue;
    }

    // Date-only line (skip, don't treat as anything)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)) {
      continue;
    }

    const stockMatch = line.match(/Stock\s*#:\s*(\S+)/);
    if (stockMatch) {
      current.stock_number = stockMatch[1];
    }

    const vinMatch = line.match(/VIN:\s*(\S+)/);
    if (vinMatch) {
      current.vin = vinMatch[1];
    }

    const colorMatch = line.match(/Color:\s*(.+)/);
    if (colorMatch) {
      current.color = colorMatch[1].trim();
    }

    const classMatch = line.match(/Class:\s*(.+)/);
    if (classMatch) {
      current.vehicle_class = classMatch[1].trim();
    }

    const recallMatch = line.match(/Recall Status:\s*(.+)/);
    if (recallMatch) {
      current.recall_status = recallMatch[1].trim();
    }

    const dispMatch = line.match(/Disp:\s*(.+)/);
    if (dispMatch) {
      current.disposition = dispMatch[1].trim();
    }
  }

  flushCurrent();
  return vehicles;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Use pdf-parse — no web workers needed, works on serverless
    const pdfResult = await pdfParse(buffer);
    const fullText = pdfResult.text;

    console.log("--- Extracted PDF text (first 2000 chars) ---");
    console.log(fullText.substring(0, 2000));
    console.log("--- End extract ---");

    const vehicles = parseVAutoText(fullText);

    console.log(`Parsed ${vehicles.length} vehicles from PDF`);

    if (vehicles.length === 0) {
      return NextResponse.json(
        {
          error: "No vehicles could be parsed from this PDF. Make sure it's a vAuto Pricing report.",
        },
        { status: 400 }
      );
    }

    // --- Smart Sync Logic ---
    const { data: existingVehicles, error: fetchError } = await supabase
      .from("vehicles")
      .select("id, vin, year, make, model");

    if (fetchError) {
      console.error("Fetch existing error:", fetchError);
      return NextResponse.json(
        { error: `Failed to fetch existing inventory: ${fetchError.message}` },
        { status: 500 }
      );
    }

    const existingByVin = new Map<string, any>();
    for (const ev of existingVehicles || []) {
      if (ev.vin) {
        existingByVin.set(ev.vin.toUpperCase(), ev);
      }
    }

    const pdfVins = new Set<string>();
    for (const v of vehicles) {
      if (v.vin) pdfVins.add(v.vin.toUpperCase());
    }

    let added = 0;
    let updated = 0;
    let removed = 0;
    let skipped = 0;

    for (const v of vehicles) {
      const vinUpper = v.vin ? v.vin.toUpperCase() : null;
      const record = {
        year: v.year,
        make: v.make,
        model: v.model,
        trim: v.trim || null,
        vin: v.vin || null,
        price: v.price,
        mileage: v.mileage || null,
      };

      if (vinUpper && existingByVin.has(vinUpper)) {
        const existing = existingByVin.get(vinUpper);
        const { error: updateError } = await supabase
          .from("vehicles")
          .update({ price: v.price, mileage: v.mileage || null })
          .eq("id", existing.id);

        if (updateError) {
          console.error(`Update error for ${v.vin}:`, updateError.message);
          skipped++;
        } else {
          updated++;
        }
      } else {
        const { error: insertError } = await supabase
          .from("vehicles")
          .insert(record);

        if (insertError) {
          console.error(`Insert error for ${v.vin}:`, insertError.message);
          skipped++;
        } else {
          added++;
        }
      }
    }

    const soldVehicles: any[] = [];
    for (const ev of existingVehicles || []) {
      if (ev.vin && !pdfVins.has(ev.vin.toUpperCase())) {
        soldVehicles.push(ev);
      }
    }

    for (const sv of soldVehicles) {
      const vinLower = sv.vin.toLowerCase();
      const { data: files } = await supabase.storage
        .from("vehicle-photos")
        .list(vinLower);

      if (files && files.length > 0) {
        const filePaths = files.map((f: any) => `${vinLower}/${f.name}`);
        await supabase.storage.from("vehicle-photos").remove(filePaths);
      }

      await supabase.from("vehicles").delete().eq("id", sv.id);
      removed++;
    }

    console.log(`Sync complete: ${added} added, ${updated} updated, ${removed} removed, ${skipped} skipped`);

    return NextResponse.json({
      success: true,
      added,
      updated,
      removed,
      skipped,
      total: vehicles.length,
      // Debug: include text preview so we can verify parsing
      _debug_text: fullText.substring(0, 1500),
      _debug_first_vehicle: vehicles[0] || null,
    });
  } catch (error: any) {
    console.error("PDF upload error:", error);

    return NextResponse.json(
      { error: `PDF parsing failed: ${error.message}` },
      { status: 500 }
    );
  }
}
