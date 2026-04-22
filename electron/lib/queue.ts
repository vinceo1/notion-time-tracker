import { promises as fs } from "node:fs";
import path from "node:path";
import { WriteSessionInput } from "./types.js";

interface QueueEntry {
  id: string;
  createdAt: string;
  attempts: number;
  input: WriteSessionInput;
}

export class OfflineQueue {
  private filepath: string;
  private entries: QueueEntry[] = [];

  constructor(userDataDir: string) {
    this.filepath = path.join(userDataDir, "queue.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filepath, "utf8");
      const parsed = JSON.parse(raw) as QueueEntry[];
      this.entries = Array.isArray(parsed) ? parsed : [];
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        console.warn("Could not load queue:", err);
      }
      this.entries = [];
    }
  }

  size(): number {
    return this.entries.length;
  }

  async enqueue(input: WriteSessionInput): Promise<void> {
    this.entries.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      attempts: 0,
      input,
    });
    await this.persist();
  }

  async flush(
    writeFn: (input: WriteSessionInput) => Promise<void>,
  ): Promise<{ succeeded: number; remaining: number }> {
    const remaining: QueueEntry[] = [];
    let succeeded = 0;
    for (const entry of this.entries) {
      try {
        await writeFn(entry.input);
        succeeded++;
      } catch (err) {
        entry.attempts += 1;
        // Give up after 20 attempts to avoid infinite loops on truly-bad entries
        if (entry.attempts < 20) remaining.push(entry);
        else console.warn("Dropping queue entry after 20 failed attempts:", entry.id, err);
      }
    }
    this.entries = remaining;
    await this.persist();
    return { succeeded, remaining: remaining.length };
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filepath), { recursive: true });
    await fs.writeFile(
      this.filepath,
      JSON.stringify(this.entries, null, 2),
      "utf8",
    );
  }
}
