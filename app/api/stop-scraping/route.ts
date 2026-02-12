import { NextResponse } from "next/server";
import { setShouldStop, getShouldStop } from "@/lib/scrape-control";

export async function POST() {
  setShouldStop(true);
  return NextResponse.json({ success: true, message: "Scraping will stop after the current vehicle." });
}

export async function GET() {
  return NextResponse.json({ shouldStop: getShouldStop() });
}
