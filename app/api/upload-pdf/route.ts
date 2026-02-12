export const runtime = "nodejs";

// Polyfill browser APIs that pdfjs-dist needs on serverless (Vercel)
if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;
    constructor(init?: any) {
      if (Array.isArray(init) && init.length === 6) {
        this.a = init[0]; this.b = init[1]; this.c = init[2];
        this.d = init[3]; this.e = init[4]; this.f = init[5];
      }
    }
    inverse() { return new DOMMatrix(); }
    multiply() { return new DOMMatrix(); }
    scale() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
  };
}
if (typeof globalThis.Path2D === "undefined") {
  (globalThis as any).Path2D = class Path2D {
    constructor() {}
    addPath() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    arc() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    ellipse() {}
  };
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Parse vAuto "Pricing (Default)" PDF text into vehicle records.
 *
 * The extracted text comes out as blocks like:
 *   2015 Ford Edge SEL
 *   $8,495
 *   Color: Ingot Silver
 *   Stock #: N04252B
 *   VIN: 2FMTK4J85FBB65810
 *   Class: SUV, Intermediate
 *   Body: 4D Sport Utility 2/7/2026 99,377
 *
 * Each vehicle block starts with a line beginning with a 4-digit year
 * (the vehicle name), followed by a price line starting with $.
 * Metadata lines (Color, Stock #, VIN, Class, Body, Recall Status)
 * follow in varying order.
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

  // Check if a line is a header/footer to skip
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

    // Detect a new vehicle line: starts with 4-digit year followed by make/model
    // Must NOT be a line that just happens to start with a number (like Body or price)
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

      // Check if price is inline with the vehicle name (e.g. "Kia Optima LX $5,995")
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

    // If no current vehicle context, skip
    if (!current) continue;

    // Price line: starts with $
    const priceMatch = line.match(/^\$([0-9,]+)/);
    if (priceMatch) {
      current.price = priceMatch[1].replace(/,/g, "");
      continue;
    }

    // Body line: "Body: 4D Sport Utility 2/7/2026 99,377"
    const bodyMatch = line.match(
      /Body:\s+(.+?)\s+(?:(\d{1,2}\/\d{1,2}\/\d{4})\s+)?([0-9,]+)\s*$/
    );
    if (bodyMatch) {
      current.body = bodyMatch[1].trim();
      current.mileage = bodyMatch[3].replace(/,/g, "");
      continue;
    }
    // Body without mileage/date
    const bodySimple = line.match(/Body:\s+(.+)/);
    if (bodySimple && !bodyMatch) {
      current.body = bodySimple[1].trim();
      continue;
    }

    // Stock #
    const stockMatch = line.match(/Stock\s*#:\s*(\S+)/);
    if (stockMatch) {
      current.stock_number = stockMatch[1];
    }

    // VIN
    const vinMatch = line.match(/VIN:\s*(\S+)/);
    if (vinMatch) {
      current.vin = vinMatch[1];
    }

    // Color
    const colorMatch = line.match(/Color:\s*(.+)/);
    if (colorMatch) {
      current.color = colorMatch[1].trim();
    }

    // Class
    const classMatch = line.match(/Class:\s*(.+)/);
    if (classMatch) {
      current.vehicle_class = classMatch[1].trim();
    }

    // Recall Status
    const recallMatch = line.match(/Recall Status:\s*(.+)/);
    if (recallMatch) {
      current.recall_status = recallMatch[1].trim();
    }

    // Disposition (Disp:)
    const dispMatch = line.match(/Disp:\s*(.+)/);
    if (dispMatch) {
      current.disposition = dispMatch[1].trim();
    }
  }

  // Don't forget the last vehicle
  flushCurrent();

  return vehicles;
}

export async function POST(req: Request) {
  try {
    // Import legacy Node build of pdfjs — disable worker for serverless
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;

    // Extract text preserving line structure using Y-coordinates
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      // Group text items by their Y position to reconstruct lines
      const lineMap = new Map<number, { x: number; str: string }[]>();

      for (const item of content.items as any[]) {
        if (!item.str || item.str.trim() === "") continue;

        // Round Y to nearest integer to group items on the same visual line
        const y = Math.round(item.transform[5]);
        const x = item.transform[4];

        if (!lineMap.has(y)) {
          lineMap.set(y, []);
        }
        lineMap.get(y)!.push({ x, str: item.str });
      }

      // Sort lines top-to-bottom (highest Y first in PDF coords)
      const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

      for (const y of sortedYs) {
        const items = lineMap.get(y)!;
        // Sort items left-to-right
        items.sort((a, b) => a.x - b.x);
        const lineText = items.map((it) => it.str).join(" ");
        fullText += lineText + "\n";
      }
    }

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
    // 1. Get all existing vehicles from DB
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

    // Build a map of existing VINs → DB records
    const existingByVin = new Map<string, any>();
    for (const ev of existingVehicles || []) {
      if (ev.vin) {
        existingByVin.set(ev.vin.toUpperCase(), ev);
      }
    }

    // Build a set of VINs from the new PDF
    const pdfVins = new Set<string>();
    for (const v of vehicles) {
      if (v.vin) pdfVins.add(v.vin.toUpperCase());
    }

    let added = 0;
    let updated = 0;
    let removed = 0;
    let skipped = 0;

    // 2. Insert new vehicles, update existing ones
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
        // Vehicle exists — update price and mileage (they may have changed)
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
        // New vehicle — insert
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

    // 3. Remove vehicles that are NOT in the new PDF (they were sold)
    const soldVehicles: any[] = [];
    for (const ev of existingVehicles || []) {
      if (ev.vin && !pdfVins.has(ev.vin.toUpperCase())) {
        soldVehicles.push(ev);
      }
    }

    for (const sv of soldVehicles) {
      // Delete photos from storage
      const vinLower = sv.vin.toLowerCase();
      const { data: files } = await supabase.storage
        .from("vehicle-photos")
        .list(vinLower);

      if (files && files.length > 0) {
        const filePaths = files.map((f: any) => `${vinLower}/${f.name}`);
        await supabase.storage.from("vehicle-photos").remove(filePaths);
      }

      // Delete the vehicle record
      await supabase.from("vehicles").delete().eq("id", sv.id);
      removed++;
    }

    // 4. Update last upload timestamp
    console.log(`Sync complete: ${added} added, ${updated} updated, ${removed} removed, ${skipped} skipped`);

    return NextResponse.json({
      success: true,
      added,
      updated,
      removed,
      skipped,
      total: vehicles.length,
    });
  } catch (error: any) {
    console.error("PDF upload error:", error);

    return NextResponse.json(
      { error: `PDF parsing failed: ${error.message}` },
      { status: 500 }
    );
  }
}
