export const runtime = "nodejs";
export const maxDuration = 300;

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

async function generateDescription(vehicle: any): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert car salesperson at Newby Buick GMC in Saint George, Utah writing high-converting Facebook Marketplace posts. The salesperson's name is Gunner Hillin and his direct number is 435-633-0213. Always include the salesperson's name, phone number, and dealership location in the post.",
        },
        {
          role: "user",
          content: `Write a strong Facebook Marketplace description for:\n\nYear: ${vehicle.year}\nMake: ${vehicle.make}\nModel: ${vehicle.model}\nTrim: ${vehicle.trim}\nMileage: ${vehicle.mileage}\nPrice: $${vehicle.price}\n\nInclude emojis, a strong call to action, and end with:\nAsk for Gunner Hillin\n📞 435-633-0213\n📍 Newby Buick GMC - Saint George, UT`,
        },
      ],
    });
    return completion.choices[0].message.content || null;
  } catch (err: any) {
    console.error("Description generation error:", err.message);
    return null;
  }
}

export async function POST() {
  try {
    // Get ALL vehicles (regenerate every description)
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to fetch vehicles: ${error.message}` },
        { status: 500 }
      );
    }

    if (!vehicles || vehicles.length === 0) {
      return NextResponse.json(
        { error: "No vehicles found" },
        { status: 400 }
      );
    }

    let regenerated = 0;
    let failed = 0;

    for (const vehicle of vehicles) {
      console.log(
        `Regenerating description for ${vehicle.year} ${vehicle.make} ${vehicle.model}...`
      );

      const description = await generateDescription(vehicle);
      if (description) {
        const { error: updateError } = await supabase
          .from("vehicles")
          .update({ description_a: description })
          .eq("id", vehicle.id);

        if (updateError) {
          console.error(`Update failed for ${vehicle.vin}: ${updateError.message}`);
          failed++;
        } else {
          regenerated++;
        }
      } else {
        failed++;
      }
    }

    console.log(`Regenerated ${regenerated} descriptions, ${failed} failed`);

    return NextResponse.json({
      success: true,
      regenerated,
      failed,
      total: vehicles.length,
    });
  } catch (err: any) {
    console.error("Regen error:", err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
