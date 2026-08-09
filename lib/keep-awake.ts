import { spawn, type ChildProcess } from "node:child_process";

/**
 * Keep the machine awake while a live session is recording, so an interview
 * isn't cut short by the computer idle-sleeping (which would stop the mic and
 * the coach).
 *
 * macOS only: uses the system `caffeinate` binary. Windows (a later packaging
 * target) needs its own mechanism (SetThreadExecutionState) — no-op there for
 * now, same platform caveat as the `afconvert` audio path.
 *
 * Runs in the long-lived Node server process (the routes use the Node runtime),
 * so a module-level singleton handle persists across the start/end requests.
 */
let proc: ChildProcess | null = null;

/** Begin preventing idle sleep. Idempotent — a second call is a no-op while an
 *  assertion is already held. */
export function preventSleep(): void {
  if (process.platform !== "darwin") return;
  if (proc && proc.exitCode === null && !proc.killed) return;
  try {
    // -d: prevent DISPLAY sleep. This is what makes it hold ON BATTERY: caffeinate's
    //     `-s` (prevent system sleep) is AC-only, and `-i` alone lets a portable
    //     drop to sleep once the display sleeps on battery. Keeping the display
    //     awake keeps the whole machine awake regardless of power source (the
    //     display is on during an interview anyway). Costs some battery — that's
    //     the trade for not losing the recording.
    // -i: prevent idle system sleep (belt-and-suspenders with -d).
    // -m: prevent disk idle sleep.
    // -w <pid>: release automatically if THIS server process dies by any means
    //     (crash, force-quit, SIGKILL) — a safety net so an assertion can never
    //     be orphaned and hold the Mac awake forever.
    proc = spawn("caffeinate", ["-d", "-i", "-m", "-w", String(process.pid)], {
      stdio: "ignore",
    });
    proc.on("error", () => {
      proc = null;
    });
    proc.on("exit", () => {
      proc = null;
    });
  } catch {
    proc = null;
  }
}

/** Release the sleep-prevention assertion (call when the live session ends). */
export function allowSleep(): void {
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }
  proc = null;
}
