export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const DEALER_ID = "18776";
const BASE_URL = `https://www.newbybuick.com/inventoryphotos/${DEALER_ID}`;
const MAX_PHOTOS = 50;

/**
 * Generate an FB Marketplace description for a vehicle using OpenAI.
 */
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
 * Scrape photos from newbybuick.com for a vehicle by VIN,
 * then auto-generate an FB Marketplace description if one doesn't exist.
 */
export async function POST(req: Request) {
  try {
    const { vehicleId, vin } = await req.json();

    if (!vin) {
      return NextResponse.json({ error: "VIN is required" }, { status: 400 });
    }

    const vinLower = vin.toLowerCase();
    const photoUrls: string[] = [];

    console.log(`Scraping photos for VIN: ${vin}`);

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

        const { error: uploadError } = await supabase.storage
          .from("vehicle-photos")
          .upload(storagePath, buffer, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (uploadError) {
          console.error(`Upload error for photo ${i}:`, uploadError.message);
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from("vehicle-photos")
          .getPublicUrl(storagePath);

        photoUrls.push(publicUrlData.publicUrl);
        console.log(`Uploaded photo ${i} for ${vin}`);
      } catch (fetchErr: any) {
        console.log(`Failed to fetch photo ${i}: ${fetchErr.message}`);
        break;
      }
    }

    console.log(`Found ${photoUrls.length} photos for VIN: ${vin}`);

    if (photoUrls.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No photos found for this VIN",
        photosFound: 0,
        descriptionGenerated: false,
      });
    }

    // Update the vehicle record with photo URLs
    let descriptionGenerated = false;
    if (vehicleId) {
      await supabase
        .from("vehicles")
        .update({ photos: photoUrls })
        .eq("id", vehicleId);

      // Auto-generate description if missing
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", vehicleId)
        .single();

      if (vehicle && !vehicle.description_a) {
        console.log(`Generating description for ${vin}...`);
        const description = await generateDescription(vehicle);
        if (description) {
          await supabase
            .from("vehicles")
            .update({ description_a: description })
            .eq("id", vehicleId);
          descriptionGenerated = true;
          console.log(`Description generated for ${vin}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      photosFound: photoUrls.length,
      photos: photoUrls,
      descriptionGenerated,
    });
  } catch (error: any) {
    console.error("Photo scrape error:", error);
    return NextResponse.json(
      { error: `Photo scraping failed: ${error.message}` },
      { status: 500 }
    );
  }
}
