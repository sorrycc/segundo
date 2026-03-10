import { listMemories } from "./store.js";
import { formatTagLine } from "./tags.js";

interface ExportOptions {
  format?: "md" | "json";
  from?: string;
  to?: string;
  tag?: string;
  brainPath: string;
}

export async function exportMemories(options: ExportOptions): Promise<string> {
  const memories = await listMemories(options.brainPath, {
    from: options.from,
    to: options.to,
    tag: options.tag,
  });

  // Chronological order for export (oldest first)
  memories.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return a.time.localeCompare(b.time);
  });

  if (options.format === "json") {
    return JSON.stringify(memories, null, 2);
  }

  if (memories.length === 0) return "";

  let out = "";
  let currentDate = "";
  for (const m of memories) {
    if (m.date !== currentDate) {
      if (currentDate) out += "\n";
      out += `# ${m.date}\n\n`;
      currentDate = m.date;
    }
    let content = m.content;
    if (m.tags.length > 0) content += "\n" + formatTagLine(m.tags);
    out += `## ${m.time} - ${m.id}\n${content}\n\n`;
  }

  return out;
}
