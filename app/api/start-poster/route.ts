import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export async function POST() {
  // Only works locally — Vercel doesn't have Playwright
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    return NextResponse.json(
      {
        error:
          "Auto-poster can't run on Vercel. Double-click run-poster.bat on your computer instead.",
      },
      { status: 400 }
    );
  }

  const projectRoot = process.cwd();
  const posterScript = join(projectRoot, "scripts", "fb-poster.mjs");
  const sessionDir = join(projectRoot, ".fb-session");

  if (!existsSync(posterScript)) {
    return NextResponse.json(
      { error: "Poster script not found" },
      { status: 404 }
    );
  }

  if (!existsSync(sessionDir)) {
    return NextResponse.json(
      {
        error:
          "No Facebook session found. Run 'npm run fb-login' in your terminal first.",
      },
      { status: 400 }
    );
  }

  // Spawn the poster as a detached background process
  try {
    const child = spawn("node", [posterScript], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
    });

    child.unref(); // Let it run independently

    return NextResponse.json({
      success: true,
      message: "Auto-poster started! Check the terminal window for progress.",
      pid: child.pid,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to start poster: ${err.message}` },
      { status: 500 }
    );
  }
}
