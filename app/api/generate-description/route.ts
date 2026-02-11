import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { vehicleId } = await req.json();

    // Get vehicle
    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .single();

    if (error || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const prompt = `
Write a high-converting Facebook Marketplace description for this vehicle.

Year: ${vehicle.year}
Make: ${vehicle.make}
Model: ${vehicle.model}
Trim: ${vehicle.trim}
Mileage: ${vehicle.mileage}
Price: ${vehicle.price}

Make it:
- Engaging
- Professional
- Include emojis
- Include call to action
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const description = completion.choices[0].message.content || "";

    // Save to database
    const { error: updateError } = await supabase
      .from("vehicles")
      .update({ description_a: description })
      .eq("id", vehicleId);

    if (updateError) {
      return NextResponse.json({ error: "Database update failed" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      description,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
