import { promises as fs } from "node:fs";
import path from "node:path";
import type { RecentTask, TodayStats } from "./types.js";

interface StatsFile {
  today: TodayStats;
  recent: RecentTask[];
}

const MAX_RECENT = 15;

function todayIso(): string {
  // Use local-tz calendar date — matches what the user sees on their wall.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Persists two pieces of usage state to a single JSON file in userData:
 *   - today's cumulative tracked seconds (auto-resets at midnight)
 *   - an LRU of the last N distinct tasks the user has tracked via
 *     this app (for the "Recent" dropdown).
 *
 * Stored separately from config.json because it's frequently written
 * (once per Stop + on every live-tick flush) and we don't want to
 * churn the config on every session.
 */
export class StatsStore {
  private filepath: string;
  private data: StatsFile;

  constructor(userDataDir: string) {
    this.filepath = path.join(userDataDir, "stats.json");
    this.data = {
      today: { date: todayIso(), totalSeconds: 0 },
      recent: [],
    };
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filepath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StatsFile>;
      if (parsed.today && typeof parsed.today.totalSeconds === "number") {
        this.data.today = {
          date: parsed.today.date ?? todayIso(),
          totalSeconds: Math.max(0, parsed.today.totalSeconds),
        };
      }
      if (Array.isArray(parsed.recent)) {
        this.data.recent = parsed.recent.slice(0, MAX_RECENT);
      }
      this.rolloverIfNeeded();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Could not load stats.json; starting fresh:", err);
      }
      // Fresh file — persist the defaults so the path exists.
      await this.persist();
    }
  }

  /**
   * Return today's tracked total. If the stored date is stale
   * (app open across midnight), reset silently first.
   */
  getToday(): TodayStats {
    this.rolloverIfNeeded();
    return { ...this.data.today };
  }

  getRecent(): RecentTask[] {
    return this.data.recent.map((r) => ({ ...r }));
  }

  async addSessionSeconds(seconds: number): Promise<TodayStats> {
    this.rolloverIfNeeded();
    this.data.today.totalSeconds += Math.max(0, Math.floor(seconds));
    await this.persist();
    return { ...this.data.today };
  }

  /**
   * Remember a task as "just tracked". Moves it to the front of the LRU
   * if already present, otherwise prepends and trims to `MAX_RECENT`.
   */
  async touchRecent(entry: Omit<RecentTask, "lastTrackedAt">): Promise<RecentTask[]> {
    const now = new Date().toISOString();
    const filtered = this.data.recent.filter((r) => r.taskId !== entry.taskId);
    filtered.unshift({ ...entry, lastTrackedAt: now });
    this.data.recent = filtered.slice(0, MAX_RECENT);
    await this.persist();
    return this.getRecent();
  }

  private rolloverIfNeeded(): void {
    const today = todayIso();
    if (this.data.today.date !== today) {
      this.data.today = { date: today, totalSeconds: 0 };
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filepath), { recursive: true });
    await fs.writeFile(this.filepath, JSON.stringify(this.data, null, 2), "utf8");
  }
}
