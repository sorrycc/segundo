import { join } from "path";
import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import type { EmbeddingMeta } from "./types.js";
import { listMemories } from "./store.js";

interface Stats {
  totalMemories: number;
  dateRange: { oldest: string; newest: string } | null;
  topTags: Array<{ tag: string; count: number }>;
  embeddingIndex: { vectorCount: number; fileSize: number } | null;
  brainPath: string;
}

export async function getStats(brainPath: string): Promise<Stats> {
  const memories = await listMemories(brainPath);

  let dateRange: Stats["dateRange"] = null;
  if (memories.length > 0) {
    const dates = memories.map((m) => m.date).sort();
    dateRange = { oldest: dates[0], newest: dates[dates.length - 1] };
  }

  const tagCounts = new Map<string, number>();
  for (const m of memories) {
    for (const t of m.tags) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  let embeddingIndex: Stats["embeddingIndex"] = null;
  const metaFile = join(brainPath, "embeddings", "meta.json");
  const binFile = join(brainPath, "embeddings", "index.bin");
  if (existsSync(metaFile)) {
    try {
      const meta: EmbeddingMeta = JSON.parse(
        await readFile(metaFile, "utf-8"),
      );
      const activeVectors = meta.entries.filter((e) => !e.deleted).length;
      const fileSize = existsSync(binFile) ? statSync(binFile).size : 0;
      embeddingIndex = { vectorCount: activeVectors, fileSize };
    } catch {}
  }

  return { totalMemories: memories.length, dateRange, topTags, embeddingIndex, brainPath };
}
