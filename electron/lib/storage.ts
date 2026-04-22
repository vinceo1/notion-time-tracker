import { promises as fs } from "node:fs";
import path from "node:path";
import { AppConfig, DEFAULT_CONFIG } from "./types.js";

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
      this.data = { ...DEFAULT_CONFIG, ...parsed };
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
