import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AppConfig,
  DEFAULT_CONFIG,
  DEFAULT_POMODORO_CONFIG,
} from "./types.js";

/**
 * On-disk shape of config.json. The Notion token is stored encrypted
 * via Electron safeStorage (Keychain on macOS, DPAPI on Windows) as
 * `notionTokenEncrypted`; the legacy plaintext `notionToken` field is
 * only read for migration and only written when OS encryption is
 * unavailable.
 */
type DiskConfig = Partial<AppConfig> & { notionTokenEncrypted?: string };

export class ConfigStore {
  private filepath: string;
  private data: AppConfig = { ...DEFAULT_CONFIG };

  constructor(userDataDir: string) {
    this.filepath = path.join(userDataDir, "config.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filepath, "utf8");
      const { notionTokenEncrypted, ...parsed } = JSON.parse(raw) as DiskConfig;

      let notionToken =
        typeof parsed.notionToken === "string" ? parsed.notionToken : "";
      const hadPlaintextToken = notionToken.length > 0;
      if (notionTokenEncrypted) {
        try {
          notionToken = safeStorage.decryptString(
            Buffer.from(notionTokenEncrypted, "base64"),
          );
        } catch (err) {
          console.warn(
            "Could not decrypt stored Notion token (keychain changed?); it must be re-entered in Settings:",
            err,
          );
          notionToken = "";
        }
      }

      this.data = {
        ...DEFAULT_CONFIG,
        ...parsed,
        notionToken,
        pomodoro: {
          ...DEFAULT_POMODORO_CONFIG,
          ...(parsed.pomodoro ?? {}),
          enabled: parsed.pomodoro?.enabled === true,
        },
        windowBounds: normalizeWindowBounds(parsed.windowBounds),
        maxSessionMinutes: normalizeMaxSessionMinutes(
          parsed.maxSessionMinutes,
        ),
      };

      // Migrate a legacy plaintext token to encrypted-at-rest.
      if (hadPlaintextToken && safeStorage.isEncryptionAvailable()) {
        await this.save();
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        await this.save();
        return;
      }
      console.warn("Could not load config, using defaults:", err);
      this.data = { ...DEFAULT_CONFIG };
    }
  }

  get(): AppConfig {
    return { ...this.data };
  }

  async update(patch: Partial<AppConfig>): Promise<void> {
    this.data = { ...this.data, ...patch };
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filepath), { recursive: true });
    const { notionToken, ...rest } = this.data;
    const disk: DiskConfig = { ...rest, notionToken: "" };
    if (notionToken && safeStorage.isEncryptionAvailable()) {
      disk.notionTokenEncrypted = safeStorage
        .encryptString(notionToken)
        .toString("base64");
    } else if (notionToken) {
      console.warn(
        "OS keychain encryption unavailable; storing Notion token as plaintext.",
      );
      disk.notionToken = notionToken;
    }
    await fs.writeFile(this.filepath, JSON.stringify(disk, null, 2), "utf8");
  }
}

function normalizeWindowBounds(
  value: Partial<AppConfig>["windowBounds"],
): AppConfig["windowBounds"] {
  if (!value) return null;
  const { x, y, width, height } = value;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(340, Math.round(width)),
    height: Math.max(360, Math.round(height)),
  };
}

function normalizeMaxSessionMinutes(value: unknown): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.max(1, Math.round(Number(value)))
    : DEFAULT_CONFIG.maxSessionMinutes;
}
