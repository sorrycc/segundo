import type { Memory, SearchResult } from "./types.js";

export function textSearch(
  memories: Memory[],
  query: string,
  limit: number = 10,
): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const memory of memories) {
    if (memory.content.toLowerCase().includes(q)) {
      results.push({ memory, score: 1 });
    }
  }

  results.sort((a, b) => {
    const cmp = b.memory.date.localeCompare(a.memory.date);
    if (cmp !== 0) return cmp;
    return b.memory.time.localeCompare(a.memory.time);
  });

  return results.slice(0, limit);
}
