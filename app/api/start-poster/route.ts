import { NextResponse } from "next/server";

export async function POST() {
  // Only works locally — Vercel doesn't have Playwright
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "Auto-poster can't run on Vercel. Double-click run-poster.bat on your computer instead.",
      },
      { status: 400 }
    );
  }

  // Dynamic imports so Vercel's bundler doesn't try to resolve them at build time
  const { spawn } = await import("child_process");
  const { existsSync } = await import("fs");
  const { join } = await import("path");

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

  try {
    const child = spawn("node", [posterScript], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
    });

    child.unref();

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
