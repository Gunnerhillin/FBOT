import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "../../../../lib/auth";
import { getServiceClient } from "../../../../lib/supabase";

export async function POST(request: NextRequest) {
  const { user, errorResponse } = await withAdmin(request);
  if (errorResponse) return errorResponse;

  const { email, full_name, password } = await request.json();

  if (!email || !full_name || !password) {
    return NextResponse.json({ error: "Email, name, and password are required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const svc = getServiceClient();

  // Create user in Supabase Auth
  const { data: authData, error: authError } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm email
    user_metadata: { full_name, role: "salesperson" },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    user: {
      id: authData.user.id,
      email,
      full_name,
    },
  });
}
