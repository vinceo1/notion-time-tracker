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
 * Download the asset to ~/Downloads and return the absolute path of the saved
 * file. The caller decides whether to open it (shell.openPath) or just reveal.
 */
export async function downloadAssetToDownloads(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "notion-time-tracker" },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const downloadsDir = path.join(os.homedir(), "Downloads");
  await fs.mkdir(downloadsDir, { recursive: true });
  const filename = decodeURIComponent(path.basename(new URL(url).pathname));
  const filepath = path.join(downloadsDir, filename);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filepath, buf);
  return filepath;
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
    // Prefer a DMG that matches the host arch, fall back to any DMG.
    const archMatch = names.find(
      (x) => x.name.endsWith(".dmg") && x.name.includes(arch),
    );
    if (archMatch) return archMatch.a;
    const anyDmg = names.find((x) => x.name.endsWith(".dmg"));
    return anyDmg?.a;
  }
  if (platform === "win32") {
    // Installer first, portable as a fallback.
    const installer = names.find(
      (x) =>
        x.name.toLowerCase().endsWith(".exe") &&
        !/portable/i.test(x.name) &&
        x.name.includes(arch.replace("x64", "x64")),
    );
    if (installer) return installer.a;
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
