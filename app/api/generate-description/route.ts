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

    const prompt = `Write a strong Facebook Marketplace description for:

Year: ${vehicle.year}
Make: ${vehicle.make}
Model: ${vehicle.model}
Trim: ${vehicle.trim}
Mileage: ${vehicle.mileage}
Price: $${vehicle.price}

Make it engaging, professional, and include emojis and a strong call to action.
End with:
Ask for Gunner Hillin
📞 435-633-0213
📍 Newby Buick GMC - Saint George, UT`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert car salesperson at Newby Buick GMC in Saint George, Utah writing high-converting Facebook Marketplace posts. The salesperson's name is Gunner Hillin and his direct number is 435-633-0213. Always include the salesperson's name, phone number, and dealership location in the post.",
        },
        { role: "user", content: prompt },
      ],
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
