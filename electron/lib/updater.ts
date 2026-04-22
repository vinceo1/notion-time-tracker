import { randomBytes } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
}

const GITHUB_OWNER = "vinceo1";
const GITHUB_REPO = "notion-time-tracker";
const LATEST_ENDPOINT = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Ten minutes is generous enough for a flaky hotel Wi-Fi on a 150 MB DMG,
// short enough that a stuck connection doesn't leave "Downloading…" on
// the screen forever.
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
]);
const RELEASE_PATH_PREFIX = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/`;

// Windows reserves these base names regardless of extension. Adding a safety
// prefix is cheaper than trying to rename a pre-existing CON.dmg on Windows.
const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

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
 * True if the URL points to this repo's release assets on an allowed
 * GitHub host. Everything else (other repos, arbitrary hosts, non-HTTPS)
 * is rejected.
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
  if (
    parsed.hostname === "github.com" &&
    !parsed.pathname.startsWith(RELEASE_PATH_PREFIX)
  ) {
    return false;
  }
  return true;
}

/**
 * Download the asset to ~/Downloads and return the absolute path of the
 * saved file. Streams to disk (constant memory), times out on stalls,
 * reports progress, rejects untrusted URLs, and never overwrites an
 * existing file — a versioned name like "Foo (1).dmg" is picked instead.
 */
export async function downloadAssetToDownloads(
  url: string,
  opts?: {
    onProgress?: (p: DownloadProgress) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<string> {
  if (!isSafeAssetUrl(url)) {
    throw new Error(
      `Refusing to download from an untrusted URL: ${safeDisplayUrl(url)}`,
    );
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort(opts?.signal?.reason);
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`Download timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "notion-time-tracker" },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
    throw err;
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const downloadsDir = path.join(os.homedir(), "Downloads");
  await fs.mkdir(downloadsDir, { recursive: true });

  const baseName =
    sanitizeFilename(decodeURIComponent(path.basename(new URL(url).pathname))) ||
    `download-${Date.now()}.bin`;

  const tmpPath = path.join(
    downloadsDir,
    `.${baseName}.${randomBytes(8).toString("hex")}.part`,
  );

  const totalHeader = res.headers.get("content-length");
  const totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : null;
  let bytesDownloaded = 0;

  // Node's WHATWG ReadableStream → Node Readable for pipeline compatibility.
  const webStream = res.body;
  const nodeReadable = Readable.fromWeb(
    webStream as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  );

  // Emit progress on each chunk without buffering the whole body.
  nodeReadable.on("data", (chunk: Buffer) => {
    bytesDownloaded += chunk.length;
    opts?.onProgress?.({
      bytesDownloaded,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
    });
  });

  try {
    // `wx` flag on the write stream fails if the temp path already exists
    // — guards against the pathologically-unlucky duplicate 16-byte suffix.
    const out = createWriteStream(tmpPath, { flags: "wx" });
    await pipeline(nodeReadable, out);
    const finalPath = await atomicallyPlace(tmpPath, downloadsDir, baseName);
    return finalPath;
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Move `tmpPath` into `dir/baseName`, picking a versioned fallback name
 * like "Foo (1).dmg" if the target already exists. Uses `rename` with
 * `wx`-backed retries to avoid TOCTOU races against a concurrent writer.
 */
async function atomicallyPlace(
  tmpPath: string,
  dir: string,
  baseName: string,
): Promise<string> {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let i = 0; i < 1000; i++) {
    const candidateName = i === 0 ? baseName : `${stem} (${i})${ext}`;
    const candidate = path.join(dir, candidateName);
    try {
      // Probe via `open({ flag: "wx" })` then close + unlink; if another
      // process slipped in between, we loop. Plain fs.rename wouldn't
      // fail on an existing target so we need this guard.
      const fh = await fs.open(candidate, "wx");
      await fh.close();
      await fs.unlink(candidate);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") continue; // occupied, try the next number
      if (code === "ENOENT") continue; // race in unlink, harmless
      throw err;
    }
    try {
      await fs.rename(tmpPath, candidate);
      return candidate;
    } catch (err) {
      // Another writer beat us to this slot; retry with the next name.
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(`Could not find a free filename in ${dir}`);
}

function sanitizeFilename(name: string): string {
  // Strip path separators, NUL, and control chars.
  let clean = name.replace(/[\x00-\x1f\x7f\\/]/g, "_").trim();
  // Windows strips trailing dots and spaces; do it here so the filename
  // round-trips between platforms.
  clean = clean.replace(/[. ]+$/g, "");
  // Cap absurd lengths (most filesystems cap at 255 chars for a single
  // path component; leave headroom for our temp-file suffix).
  if (clean.length > 200) {
    const ext = path.extname(clean);
    clean = clean.slice(0, 200 - ext.length) + ext;
  }
  // Avoid the Windows reserved names by prefixing an underscore.
  const stemLower = path
    .basename(clean, path.extname(clean))
    .toLowerCase();
  if (WINDOWS_RESERVED.has(stemLower)) {
    clean = `_${clean}`;
  }
  return clean;
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
