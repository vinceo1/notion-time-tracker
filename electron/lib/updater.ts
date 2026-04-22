import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  /** Direct download URL for the platform-appropriate asset. */
  downloadUrl: string | null;
  /** HTML release page on GitHub. */
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  /** "no_releases" when the repo has no releases yet — UI can show a friendlier message. */
  reason: "ok" | "no_releases";
}

const GITHUB_OWNER = "vinceo1";
const GITHUB_REPO = "notion-time-tracker";
const LATEST_ENDPOINT = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Hosts we're willing to fetch update binaries from. Everything else is
// rejected outright. GitHub redirects release-asset downloads from
// github.com → objects.githubusercontent.com (Azure-hosted S3), so both
// must be in the allowlist.
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
]);
const RELEASE_PATH_PREFIX = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/`;

export async function checkForUpdate(
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<UpdateCheckResult> {
  const res = await fetch(LATEST_ENDPOINT, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "notion-time-tracker",
    },
  });

  if (res.status === 404) {
    return {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      downloadUrl: null,
      releaseUrl: null,
      releaseName: null,
      publishedAt: null,
      reason: "no_releases",
    };
  }

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const release = (await res.json()) as GitHubRelease;
  const latestVersion = (release.tag_name ?? "").replace(/^v/, "");
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

  let downloadUrl: string | null = null;
  if (Array.isArray(release.assets)) {
    const asset = pickAssetForPlatform(release.assets, platform, arch);
    if (asset) downloadUrl = asset.browser_download_url;
  }

  // Defense in depth: if, for any reason, the API ever returned a URL we
  // wouldn't accept at download time, treat the asset as missing instead
  // of leaking a rogue URL to the renderer.
  if (downloadUrl && !isSafeAssetUrl(downloadUrl)) {
    downloadUrl = null;
  }

  return {
    currentVersion,
    latestVersion: latestVersion || null,
    hasUpdate,
    downloadUrl,
    releaseUrl: release.html_url ?? null,
    releaseName: release.name ?? null,
    publishedAt: release.published_at ?? null,
    reason: "ok",
  };
}

/**
 * True if the URL points to this repo's release assets on an allowed GitHub
 * host. Everything else (other repos, arbitrary hosts, non-HTTPS) is rejected.
 */
export function isSafeAssetUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) return false;
  // github.com URLs MUST live under this repo's releases path; the S3-style
  // redirect host doesn't expose a repo path, so we can only gate by host.
  if (
    parsed.hostname === "github.com" &&
    !parsed.pathname.startsWith(RELEASE_PATH_PREFIX)
  ) {
    return false;
  }
  return true;
}

/**
 * Download the asset to ~/Downloads and return the absolute path of the saved
 * file. The caller decides whether to open it (shell.openPath) or just reveal.
 *
 * The URL is validated against `isSafeAssetUrl` first — a hard guarantee that
 * we'll never fetch-and-execute a binary from an unexpected origin even if a
 * compromised renderer forwards one in.
 *
 * The write is staged to a temp file in the Downloads dir and moved into
 * place atomically; if the target filename already exists (e.g. a prior
 * download of the same version) a versioned name like
 * "Notion Time Tracker-0.3.0-arm64 (1).dmg" is picked instead.
 */
export async function downloadAssetToDownloads(url: string): Promise<string> {
  if (!isSafeAssetUrl(url)) {
    throw new Error(
      `Refusing to download from an untrusted URL: ${safeDisplayUrl(url)}`,
    );
  }

  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "notion-time-tracker" },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const downloadsDir = path.join(os.homedir(), "Downloads");
  await fs.mkdir(downloadsDir, { recursive: true });

  const baseName =
    sanitizeFilename(decodeURIComponent(path.basename(new URL(url).pathname))) ||
    `download-${Date.now()}.bin`;

  const tmpName = `.${baseName}.${randomBytes(8).toString("hex")}.part`;
  const tmpPath = path.join(downloadsDir, tmpName);

  const buf = Buffer.from(await res.arrayBuffer());
  try {
    // `wx` fails if the temp file somehow already exists — prevents a race
    // where two concurrent downloads pick the same temp name (astronomically
    // unlikely given 16 hex chars, but fail-closed is cheap).
    await fs.writeFile(tmpPath, buf, { flag: "wx" });
    const finalPath = await pickAvailableDestination(downloadsDir, baseName);
    await fs.rename(tmpPath, finalPath);
    return finalPath;
  } catch (err) {
    // Best-effort cleanup on failure
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Find a filename in `dir` that doesn't already exist. Returns the full path
 * of the first free candidate, starting with `baseName` and falling back to
 * "<stem> (1)<ext>", "<stem> (2)<ext>", etc.
 */
async function pickAvailableDestination(
  dir: string,
  baseName: string,
): Promise<string> {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let i = 0; i < 1000; i++) {
    const candidateName = i === 0 ? baseName : `${stem} (${i})${ext}`;
    const candidate = path.join(dir, candidateName);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`Could not find a free filename in ${dir}`);
}

function sanitizeFilename(name: string): string {
  // Strip path separators and NULs; collapse any directory-traversal tricks.
  return name.replace(/[\\/\0]/g, "_").trim();
}

function safeDisplayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubAsset[];
}

interface GitHubAsset {
  name?: string;
  browser_download_url: string;
}

function pickAssetForPlatform(
  assets: GitHubAsset[],
  platform: NodeJS.Platform,
  arch: string,
): GitHubAsset | undefined {
  const names = assets
    .map((a) => ({ a, name: a.name ?? "" }))
    .filter((x) => x.name);

  if (platform === "darwin") {
    const archMatch = names.find(
      (x) => x.name.endsWith(".dmg") && x.name.includes(arch),
    );
    if (archMatch) return archMatch.a;
    const anyDmg = names.find((x) => x.name.endsWith(".dmg"));
    return anyDmg?.a;
  }
  if (platform === "win32") {
    const setup = names.find(
      (x) =>
        x.name.toLowerCase().endsWith(".exe") && /setup/i.test(x.name),
    );
    if (setup) return setup.a;
    const nonPortable = names.find(
      (x) =>
        x.name.toLowerCase().endsWith(".exe") &&
        !/portable/i.test(x.name),
    );
    if (nonPortable) return nonPortable.a;
    const anyExe = names.find((x) => x.name.toLowerCase().endsWith(".exe"));
    return anyExe?.a;
  }
  if (platform === "linux") {
    const appImage = names.find((x) => x.name.endsWith(".AppImage"));
    return appImage?.a;
  }
  return undefined;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
