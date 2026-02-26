import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth";
import { setShouldStop, getShouldStop } from "@/lib/scrape-control";

export async function POST(request: Request) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  setShouldStop(true);
  return NextResponse.json({ success: true, message: "Scraping will stop after the current vehicle." });
}

export async function GET(request: Request) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  return NextResponse.json({ shouldStop: getShouldStop() });
}
