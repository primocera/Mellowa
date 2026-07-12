import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SafetyCheckInput } from "@/schemas/safety";
import { checkInputSafety } from "@/lib/safety/check-input";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SafetyCheckInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const result = await checkInputSafety(
    user.id,
    parsed.data.source,
    parsed.data.text
  );

  // internal_reason stays server-side
  return NextResponse.json({
    is_safe: result.is_safe,
    risk_level: result.risk_level,
    risk_types: result.risk_types,
    should_block_generation: result.should_block_generation,
    user_message: result.user_message,
  });
}
