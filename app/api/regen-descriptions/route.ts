export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function generateDescription(vehicle: any, salespersonFullName: string, salespersonPhone: string): Promise<string | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert car salesperson at Newby Buick GMC in Saint George, Utah writing high-converting Facebook Marketplace posts. The salesperson's name is ${salespersonFullName} and their direct number is ${salespersonPhone}. Always include the salesperson's name, phone number, and dealership location in the post.`,
        },
        {
          role: "user",
          content: `Write a strong Facebook Marketplace description for:\n\nYear: ${vehicle.year}\nMake: ${vehicle.make}\nModel: ${vehicle.model}\nTrim: ${vehicle.trim}\nMileage: ${vehicle.mileage}\nPrice: $${vehicle.price}\n\nInclude emojis, a strong call to action, and end with:\nAsk for ${salespersonFullName}\n📞 ${salespersonPhone}\n📍 Newby Buick GMC - Saint George, UT`,
        },
      ],
    });
    return completion.choices[0].message.content || null;
  } catch (err: any) {
    console.error("Description generation error:", err.message);
    return null;
  }
}

export async function POST(request: Request) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  try {
    const svc = getServiceClient();

    // Get the admin's contact info for descriptions
    const { data: profile } = await svc
      .from("profiles")
      .select("full_name, display_name, phone")
      .eq("id", user!.id)
      .single();

    const salespersonFullName = profile?.full_name || "Gunner Hillin";
    const salespersonPhone = profile?.phone || "435-633-0213";

    // Get ALL vehicles (regenerate every description)
    const { data: vehicles, error } = await svc
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

      const description = await generateDescription(vehicle, salespersonFullName, salespersonPhone);
      if (description) {
        const { error: updateError } = await svc
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
