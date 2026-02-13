export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import pdfParse from "pdf-parse";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Custom page renderer that preserves the tabular layout by grouping text
 * items by their Y position (just like pdftotext -layout does).
 * This is critical for vAuto PDFs which are multi-column tables.
 *
 * Uses proximity-based clustering instead of fixed-bucket rounding to avoid
 * splitting items that are on the same table row but at slightly different Y coords.
 */
function layoutRenderer(pageData: any) {
  return pageData.getTextContent().then(function (textContent: any) {
    // Collect all text items
    const allItems: { y: number; x: number; str: string; width: number }[] = [];
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === "") continue;
      allItems.push({
        y: item.transform[5],
        x: item.transform[4],
        str: item.str,
        width: item.width || 0,
      });
    }

    // Sort by Y descending (top of page first in PDF coordinates)
    allItems.sort((a, b) => b.y - a.y);

    // Cluster items into lines: items within 5pt of the line's anchor Y
    // are on the same line. This avoids the hard-boundary problem of rounding.
    const lines: typeof allItems[] = [];
    let currentLine: typeof allItems = [];
    let anchorY: number | null = null;

    for (const item of allItems) {
      if (anchorY !== null && Math.abs(item.y - anchorY) <= 5) {
        currentLine.push(item);
      } else {
        if (currentLine.length > 0) {
          lines.push([...currentLine]);
        }
        currentLine = [item];
        anchorY = item.y;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    // Build text from clustered lines
    let text = "";
    for (const line of lines) {
      // Sort items left-to-right within each line
      line.sort((a, b) => a.x - b.x);

      // Join items with spaces
      const lineText = line.map((it) => it.str).join(" ");

      // Cleanup: fix split numbers like "87 , 159" → "87,159"
      text += lineText.replace(/(\d)\s*,\s*(\d)/g, "$1,$2") + "\n";
    }

    return text;
  });
}

/**
 * Parse vAuto "Pricing (Default)" PDF text into vehicle records.
 *
 * With layout-preserving extraction, each vehicle appears as a row like:
 *   2015 Dodge Charger SXT   Body: 4D Sedan   $14,495 2/9/2026   87,159
 *   Stock #: N04379C         Color: Billet Silver Metallic Clearcoat
 *   VIN: 2C3CDXJG1FH828315
 *   Class: Car, Intermediate
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
      /^Page \d+ of \d+$/.test(line) ||
      line === "Body" ||
      line === "Price / % Mkt" ||
      line === "Last $ Change" ||
      line === "Odometer"
    );
  };

  for (const line of lines) {
    if (isHeaderFooter(line)) continue;

    // Detect vehicle name line: starts with 4-digit year followed by make/model
    // In layout mode, this line may also contain Body:, price, and mileage
    const vehicleNameMatch = line.match(/^(\d{4})\s+([A-Z][a-zA-Z][\s\S]*?)(?:\s+Body:|$)/);
    if (
      vehicleNameMatch &&
      !line.startsWith("$") &&
      !line.match(/^(\d{4})\s+(Stock|VIN:|Color:|Class:)/)
    ) {
      flushCurrent();

      const year = vehicleNameMatch[1];
      let nameRaw = vehicleNameMatch[2].trim();

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
        price: "",
        mileage: "",
        body: "",
        color: "",
        vehicle_class: "",
        recall_status: "",
        disposition: "",
      };

      // In layout mode, the same line may contain Body:, Price, and Mileage
      // e.g. "2015 Dodge Charger SXT Body: 4D Sedan $14,495 2/9/2026 87,159"
      const bodyInline = line.match(/Body:\s+([^\$]+)/);
      if (bodyInline) {
        current.body = bodyInline[1].trim();
      }

      const priceInline = line.match(/\$([0-9,]+)/);
      if (priceInline) {
        current.price = priceInline[1].replace(/,/g, "");
      }

      // Mileage: try date+mileage pattern first, then fall back to last number on line
      const mileageInline = line.match(/\d{1,2}\/\d{1,2}\/\d{4}\s+([0-9,]+)/);
      if (mileageInline) {
        current.mileage = mileageInline[1].replace(/,/g, "");
      } else {
        // Fallback: grab the last standalone number on the line (not the price or year)
        // This handles no-date lines like wholesale vehicles
        const allNumbers = [...line.matchAll(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{4,})(?:\s|$)/g)];
        if (allNumbers.length > 0) {
          const lastNum = allNumbers[allNumbers.length - 1][1].replace(/,/g, "");
          const num = parseInt(lastNum, 10);
          // Only treat as mileage if it's a reasonable range (100 - 999,999)
          // and not the year or price we already captured
          if (num >= 100 && num <= 999999 && lastNum !== current.year && lastNum !== current.price) {
            current.mileage = lastNum;
          }
        }
      }

      continue;
    }

    if (!current) continue;

    // Price line (if not already captured inline)
    if (!current.price) {
      const priceMatch = line.match(/\$([0-9,]+)/);
      if (priceMatch) {
        current.price = priceMatch[1].replace(/,/g, "");

        // Check for mileage after date on same line: "$14,495 2/9/2026 87,159"
        const mileageAfterDate = line.match(/\d{1,2}\/\d{1,2}\/\d{4}\s+([0-9,]+)/);
        if (mileageAfterDate && !current.mileage) {
          current.mileage = mileageAfterDate[1].replace(/,/g, "");
        }
        continue;
      }
    }

    // Body line (if not already captured inline)
    if (!current.body) {
      const bodyMatch = line.match(/Body:\s+(.+?)(?:\s+\$|\s*$)/);
      if (bodyMatch) {
        current.body = bodyMatch[1].trim();

        // Also check for price and mileage on this line
        const priceOnBody = line.match(/\$([0-9,]+)/);
        if (priceOnBody && !current.price) {
          current.price = priceOnBody[1].replace(/,/g, "");
        }
        const mileageOnBody = line.match(/\d{1,2}\/\d{1,2}\/\d{4}\s+([0-9,]+)/);
        if (mileageOnBody && !current.mileage) {
          current.mileage = mileageOnBody[1].replace(/,/g, "");
        }
        continue;
      }
    }

    // Standalone mileage line (just a number by itself)
    if (!current.mileage && /^[0-9,]+$/.test(line)) {
      const num = parseInt(line.replace(/,/g, ""), 10);
      if (num >= 100 && num <= 999999) {
        current.mileage = String(num);
        continue;
      }
    }

    // Date + mileage: "2/7/2026 99,377"
    if (!current.mileage) {
      const dateMileage = line.match(/\d{1,2}\/\d{1,2}\/\d{4}\s+([0-9,]+)/);
      if (dateMileage) {
        current.mileage = dateMileage[1].replace(/,/g, "");
        continue;
      }
    }

    // Price + date + mileage on a separate line: "$14,495 2/9/2026 87,159"
    if (!current.mileage && !current.price) {
      const priceDateMileage = line.match(/\$([0-9,]+)\s+\d{1,2}\/\d{1,2}\/\d{4}\s+([0-9,]+)/);
      if (priceDateMileage) {
        current.price = priceDateMileage[1].replace(/,/g, "");
        current.mileage = priceDateMileage[2].replace(/,/g, "");
        continue;
      }
    }

    // Just price + mileage without date: "$14,495 87,159"
    if (!current.mileage) {
      const priceAndNum = line.match(/\$([0-9,]+)\s+(\d{1,3}(?:,\d{3})+|\d{4,})\s*$/);
      if (priceAndNum && !current.price) {
        current.price = priceAndNum[1].replace(/,/g, "");
        const possibleMileage = parseInt(priceAndNum[2].replace(/,/g, ""), 10);
        if (possibleMileage >= 100 && possibleMileage <= 999999) {
          current.mileage = String(possibleMileage);
        }
        continue;
      }
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

    // Disposition
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

    // Use pdf-parse with custom layout renderer to preserve table structure
    const pdfResult = await pdfParse(buffer, {
      pagerender: layoutRenderer,
    });
    const fullText = pdfResult.text;

    console.log("--- Extracted PDF text (first 2000 chars) ---");
    console.log(fullText.substring(0, 2000));
    console.log("--- End extract ---");

    const allVehicles = parseVAutoText(fullText);

    console.log(`Parsed ${allVehicles.length} total vehicles from PDF`);

    // Filter out vehicles with no price (wholesale, trade-ins, etc.)
    const vehicles = allVehicles.filter((v) => {
      const price = parseInt(v.price, 10);
      if (!v.price || isNaN(price) || price <= 0) {
        console.log(`  Skipping no-price vehicle: ${v.year} ${v.make} ${v.model} (price: "${v.price}")`);
        return false;
      }
      return true;
    });

    console.log(`After filtering: ${vehicles.length} vehicles with prices (${allVehicles.length - vehicles.length} skipped)`);
    // Log first 5 vehicles for debugging mileage issues
    for (let i = 0; i < Math.min(5, vehicles.length); i++) {
      console.log(`  Vehicle ${i}: ${vehicles[i].year} ${vehicles[i].make} ${vehicles[i].model} | price=${vehicles[i].price} | mileage=${vehicles[i].mileage}`);
    }

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
      _debug_text: fullText.substring(0, 3000),
      _debug_first_5: vehicles.slice(0, 5).map((v: any) => ({
        name: `${v.year} ${v.make} ${v.model}`,
        price: v.price,
        mileage: v.mileage,
        vin: v.vin,
      })),
    });
  } catch (error: any) {
    console.error("PDF upload error:", error);

    return NextResponse.json(
      { error: `PDF parsing failed: ${error.message}` },
      { status: 500 }
    );
  }
}
