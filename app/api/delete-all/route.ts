import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth";
import { getServiceClient } from "../../../lib/supabase";

export async function POST(request: Request) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  const svc = getServiceClient();
  const { error } = await svc
    .from("vehicles")
    .delete()
    .neq("id", 0); // deletes all rows

  if (error) {
    return NextResponse.json({ error: error.message });
  }

  return NextResponse.json({ success: true });
}
