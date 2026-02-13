import OpenAI from "openai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await req.json();
    const { vehicle, price } = body;

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
          content: `Write a compelling Facebook Marketplace post for a ${vehicle} listed at $${price}. Include emojis, a strong call to action, and end with:\nAsk for Gunner Hillin\n📞 435-633-0213\n📍 Newby Buick GMC - Saint George, UT`,
        },
      ],
    });

    return NextResponse.json({
      result: completion.choices[0].message.content,
    });
  } catch (error: any) {
    console.error("API ERROR:", error);

    return NextResponse.json(
      { error: error.message || "Something went wrong" },
      { status: 500 }
    );
  }
}
