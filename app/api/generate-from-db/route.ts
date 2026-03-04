import OpenAI from "openai";
import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  const { user, errorResponse } = await withAuth(req);
  if (errorResponse) return errorResponse;

  try {
    const { id } = await req.json();

    const svc = getServiceClient();

    // 1. Get vehicle from database
    const { data: vehicle, error } = await svc
      .from("vehicles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    // 2. Get the requesting user's contact info
    const { data: profile } = await svc
      .from("profiles")
      .select("full_name, display_name, phone")
      .eq("id", user!.id)
      .single();

    const salespersonFullName = profile?.full_name || "Gunner Hillin";
    const salespersonPhone = profile?.phone || "435-633-0213";

    // 3. Generate description
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert car salesperson at Newby Buick GMC in Saint George, Utah writing high-converting Facebook Marketplace posts. The salesperson's name is ${salespersonFullName} and their direct number is ${salespersonPhone}. Always include the salesperson's name, phone number, and dealership location in the post.`
        },
        {
          role: "user",
          content: `Write a strong Facebook Marketplace description for:\n\nYear: ${vehicle.year}\nMake: ${vehicle.make}\nModel: ${vehicle.model}\nTrim: ${vehicle.trim}\nMileage: ${vehicle.mileage}\nPrice: $${vehicle.price}\n\nInclude emojis, a strong call to action, and end with:\nAsk for ${salespersonFullName}\n📞 ${salespersonPhone}\n📍 Newby Buick GMC - Saint George, UT`
        }
      ],
    });

    const description = completion.choices[0].message.content;

    // 4. Save description to DB
    await svc
      .from("vehicles")
      .update({ description_a: description })
      .eq("id", id);

    return NextResponse.json({ success: true });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
