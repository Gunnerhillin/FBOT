import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

export async function GET(request: Request) {
  const { user, errorResponse } = await withAuth(request);
  if (errorResponse) return errorResponse;

  const svc = getServiceClient();
  const { data, error } = await svc
    .from("vehicles")
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
