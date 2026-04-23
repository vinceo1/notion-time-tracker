import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

const STAGING_DIR = path.join(os.tmpdir(), "notion-tt-staging");
const OLD_DIR = path.join(os.tmpdir(), "notion-tt-old");
const INSTALL_SCRIPT = path.join(os.tmpdir(), "notion-tt-install.sh");

export interface InstallOutcome {
  ok: boolean;
  installedAppPath?: string;
  /** Present when ok=false; caller can fall back to Finder-based install. */
  error?: string;
  /**
   * True when the app itself is now scheduled to quit so the helper
   * script can complete the swap. Caller should not keep running.
   */
  willQuit?: boolean;
}

/**
 * Install a downloaded DMG into /Applications without ever invoking
 * Finder. Mounting, copying and unmounting are all driven from the
 * main process via hdiutil + ditto so:
 *
 *   - File locks held by the currently-running app don't cause the
 *     notorious Finder error -36 ("some data ... could not be read
 *     or written"). The actual file swap happens from a detached
 *     helper script that runs *after* this process has exited.
 *   - The new app has its quarantine attribute scrubbed, so Gatekeeper
 *     won't flag "is damaged" on first launch.
 *
 * The caller receives `willQuit: true` when the install is staged and
 * should stop doing anything that could prevent a clean shutdown.
 */
export async function installDmgViaDitto(
  dmgPath: string,
): Promise<InstallOutcome> {
  let mountPoint: string | null = null;

  try {
    // 1. Mount the DMG silently (no Finder window).
    const { stdout } = await pexecFile(
      "hdiutil",
      ["attach", dmgPath, "-nobrowse", "-quiet", "-readonly"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    mountPoint = parseMountPoint(stdout);
    if (!mountPoint) {
      throw new Error("hdiutil attach did not report a /Volumes path");
    }

    // 2. Find the .app inside the mounted DMG.
    const entries = await fs.readdir(mountPoint);
    const appName = entries.find((e) => e.endsWith(".app"));
    if (!appName) {
      throw new Error(`No .app bundle found inside ${mountPoint}`);
    }
    const sourceApp = path.join(mountPoint, appName);

    // 3. ditto the app into a staging folder in /tmp. Doing it into
    //    /Applications now would collide with the running process;
    //    the swap happens from the detached helper below.
    await fs.rm(STAGING_DIR, { recursive: true, force: true });
    await fs.mkdir(STAGING_DIR, { recursive: true });
    const stagedApp = path.join(STAGING_DIR, appName);
    await pexecFile("ditto", [sourceApp, stagedApp]);

    // Strip quarantine on the staged copy so Gatekeeper doesn't
    // flag first launch — cheaper to do here than from the helper.
    try {
      await pexecFile("xattr", ["-dr", "com.apple.quarantine", stagedApp]);
    } catch {
      /* non-fatal */
    }

    const installedApp = path.join("/Applications", appName);

    // 4. Write a detached helper script. It waits for this process to
    //    exit, swaps /Applications/<app>.app, and relaunches. If the
    //    swap fails mid-flight it rolls the old app back into place so
    //    the user isn't left with nothing to launch.
    const script = buildInstallScript({
      appName,
      stagedApp,
      installedApp,
    });
    await fs.writeFile(INSTALL_SCRIPT, script, { mode: 0o755 });

    const child = spawn("/bin/bash", [INSTALL_SCRIPT], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return {
      ok: true,
      installedAppPath: installedApp,
      willQuit: true,
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? String(err),
    };
  } finally {
    // 5. Always unmount the DMG, even if ditto failed.
    if (mountPoint) {
      try {
        await pexecFile("hdiutil", ["detach", mountPoint, "-quiet", "-force"]);
      } catch {
        /* ignored */
      }
    }
  }
}

function parseMountPoint(stdout: string): string | null {
  // hdiutil attach prints tab-separated columns:
  //   /dev/diskN     Apple_HFS    /Volumes/Foo
  // The /Volumes/... path is what we want. Several lines may appear
  // (one per partition); pick the first that ends up under /Volumes.
  for (const line of stdout.split("\n")) {
    const cols = line.split("\t").map((c) => c.trim());
    const last = cols[cols.length - 1];
    if (last && last.startsWith("/Volumes/")) return last;
  }
  return null;
}

function buildInstallScript(args: {
  appName: string;
  stagedApp: string;
  installedApp: string;
}): string {
  // Quote every path for the shell. Lives under /tmp so neither the
  // current Electron app (which is about to quit) nor any daemon can
  // trip on stale state between runs.
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const oldBackup = path.join(OLD_DIR, args.appName);
  return `#!/bin/bash
# Notion Time Tracker install helper — auto-generated.
# Runs detached after the app quits so file locks are released.
set +e

# Give Electron a moment to fully exit.
sleep 2

STAGED=${q(args.stagedApp)}
INSTALLED=${q(args.installedApp)}
BACKUP=${q(oldBackup)}

mkdir -p ${q(OLD_DIR)}

# Move any existing install aside so we can roll back if the new
# copy trips on something unexpected.
if [ -d "$INSTALLED" ]; then
  rm -rf "$BACKUP"
  mv "$INSTALLED" "$BACKUP" || exit 1
fi

if ! mv "$STAGED" "$INSTALLED"; then
  # Restore the previous install on failure.
  if [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$INSTALLED"
  fi
  exit 1
fi

# Belt-and-braces: strip quarantine again on the installed tree
# in case the move somehow re-flagged it.
xattr -dr com.apple.quarantine "$INSTALLED" 2>/dev/null || true

# Clean up any stale backups + staging.
rm -rf ${q(OLD_DIR)} ${q(STAGING_DIR)}

# Launch the new version via LaunchServices.
open "$INSTALLED"
`;
}
