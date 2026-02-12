import { NextResponse } from "next/server";

export async function POST() {
  // The auto-poster requires Playwright + a real browser, so it can only
  // run on your local machine. This endpoint just tells the user that.
  return NextResponse.json(
    {
      error:
        "The auto-poster runs locally on your computer. Double-click run-poster.bat to start it.",
    },
    { status: 400 }
  );
}
