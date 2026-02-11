import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

    // 1️⃣ Get vehicle from database
    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    // 2️⃣ Generate description
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert car salesperson writing high-converting Facebook Marketplace posts."
        },
        {
          role: "user",
          content: `
Write a strong Facebook Marketplace description for:

Year: ${vehicle.year}
Make: ${vehicle.make}
Model: ${vehicle.model}
Trim: ${vehicle.trim}
Mileage: ${vehicle.mileage}
Price: ${vehicle.price}

Make it persuasive and ready to copy/paste.
          `
        }
      ],
    });

    const description = completion.choices[0].message.content;

    // 3️⃣ Save description to DB
    await supabase
      .from("vehicles")
      .update({ description_a: description })
      .eq("id", id);

    return NextResponse.json({ success: true });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
