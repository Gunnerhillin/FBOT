import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  const { user, errorResponse } = await withAuth(request);
  if (errorResponse) return errorResponse;
  return NextResponse.json({ user });
}
