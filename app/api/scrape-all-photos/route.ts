export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";
import OpenAI from "openai";
import { getShouldStop, setShouldStop } from "@/lib/scrape-control";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const DEALER_ID = "18776";
const BASE_URL = `https://www.newbybuick.com/inventoryphotos/${DEALER_ID}`;
const MAX_PHOTOS = 50;

async function scrapePhotosForVin(svc: any, vin: string): Promise<string[]> {
  const vinLower = vin.toLowerCase();
  const photoUrls: string[] = [];

  for (let i = 1; i <= MAX_PHOTOS; i++) {
    const imageUrl = `${BASE_URL}/${vinLower}/ip/${i}.jpg?bg-color=FFFFFF&width=1000`;

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) break;

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("image")) break;

      const arrayBuffer = await response.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      const storagePath = `${vinLower}/${i}.jpg`;

      const { error: uploadError } = await svc.storage
        .from("vehicle-photos")
        .upload(storagePath, buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error(`Upload error ${vin} photo ${i}:`, uploadError.message);
        continue;
      }

      const { data: publicUrlData } = svc.storage
        .from("vehicle-photos")
        .getPublicUrl(storagePath);

      photoUrls.push(publicUrlData.publicUrl);
    } catch {
      break;
    }
  }

  return photoUrls;
}

async function generateDescription(vehicle: any): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert car salesperson writing high-converting Facebook Marketplace posts.",
        },
        {
          role: "user",
          content: `Write a strong Facebook Marketplace description for:\n\nYear: ${vehicle.year}\nMake: ${vehicle.make}\nModel: ${vehicle.model}\nTrim: ${vehicle.trim}\nMileage: ${vehicle.mileage}\nPrice: ${vehicle.price}\n\nMake it persuasive and ready to copy/paste.`,
        },
      ],
    });
    return completion.choices[0].message.content || null;
  } catch (err: any) {
    console.error("Description generation error:", err.message);
    return null;
  }
}

/**
 * Scrape photos + auto-generate descriptions for ALL vehicles
 * that need them. Checks the stop flag between each vehicle.
 */
export async function POST(request: Request) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  setShouldStop(false);

  try {
    const svc = getServiceClient();

    const { data: vehicles, error: fetchError } = await svc
      .from("vehicles")
      .select("*")
      .not("vin", "is", null)
      .neq("vin", "");

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }

    // Vehicles that need photos OR descriptions
    const needWork = (vehicles || []).filter(
      (v: any) => !v.photos || v.photos.length === 0 || !v.description_a
    );

    console.log(
      `Processing ${needWork.length} vehicles (${vehicles?.length} total with VIN)`
    );

    let photosScraped = 0;
    let descriptionsGenerated = 0;
    let failed = 0;
    let stopped = false;
    const results: { vin: string; photos: number; description: boolean }[] = [];

    for (const v of needWork) {
      if (getShouldStop()) {
        console.log("Scraping stopped by user.");
        stopped = true;
        break;
      }

      try {
        let photoCount = v.photos?.length || 0;
        let descGenerated = false;

        // Scrape photos if needed
        if (!v.photos || v.photos.length === 0) {
          const photos = await scrapePhotosForVin(svc, v.vin);

          if (photos.length > 0) {
            await svc
              .from("vehicles")
              .update({ photos })
              .eq("id", v.id);
            photoCount = photos.length;
            photosScraped++;
            console.log(`${v.vin}: ${photos.length} photos`);
          } else {
            failed++;
            console.log(`${v.vin}: no photos found`);
          }
        }

        // Generate description if missing
        if (!v.description_a) {
          // Check stop flag before description generation too
          if (getShouldStop()) {
            stopped = true;
            break;
          }

          console.log(`${v.vin}: generating description...`);
          const description = await generateDescription(v);
          if (description) {
            await svc
              .from("vehicles")
              .update({ description_a: description })
              .eq("id", v.id);
            descriptionsGenerated++;
            descGenerated = true;
            console.log(`${v.vin}: description generated`);
          }
        }

        results.push({ vin: v.vin, photos: photoCount, description: descGenerated });
      } catch (err: any) {
        failed++;
        console.error(`${v.vin}: error - ${err.message}`);
      }
    }

    setShouldStop(false);

    return NextResponse.json({
      success: true,
      stopped,
      totalProcessed: stopped ? results.length : needWork.length,
      photosScraped,
      descriptionsGenerated,
      failed,
      results,
    });
  } catch (error: any) {
    setShouldStop(false);
    console.error("Scrape all error:", error);
    return NextResponse.json(
      { error: `Processing failed: ${error.message}` },
      { status: 500 }
    );
  }
}
