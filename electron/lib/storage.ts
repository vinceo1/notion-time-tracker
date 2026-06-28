import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AppConfig,
  DEFAULT_CONFIG,
  DEFAULT_POMODORO_CONFIG,
} from "./types.js";

export class ConfigStore {
  private filepath: string;
  private data: AppConfig = { ...DEFAULT_CONFIG };

  constructor(userDataDir: string) {
    this.filepath = path.join(userDataDir, "config.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filepath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      this.data = {
        ...DEFAULT_CONFIG,
        ...parsed,
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
    await fs.writeFile(this.filepath, JSON.stringify(this.data, null, 2), "utf8");
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
