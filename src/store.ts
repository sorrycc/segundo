import { join } from "path";
import { existsSync, readdirSync, renameSync, unlinkSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import type { Memory } from "./types.js";
import { parseTags, appendTags, formatTagLine } from "./tags.js";
import { withLock } from "./lock.js";

const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HEADER_RE = /^## (\d{2}:\d{2}) - ([a-zA-Z0-9]{8})$/;

export function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CHARSET[b % 62]).join("");
}

export function parseJournal(raw: string, date: string): Memory[] {
  const memories: Memory[] = [];
  const lines = raw.split("\n");
  let current: { time: string; id: string; contentLines: string[] } | null =
    null;

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m) {
      if (current) memories.push(finalizeEntry(current, date));
      current = { time: m[1], id: m[2], contentLines: [] };
    } else if (current) {
      current.contentLines.push(line);
    }
  }
  if (current) memories.push(finalizeEntry(current, date));
  return memories;
}

function finalizeEntry(
  entry: { time: string; id: string; contentLines: string[] },
  date: string,
): Memory {
  while (
    entry.contentLines.length > 0 &&
    entry.contentLines[entry.contentLines.length - 1] === ""
  ) {
    entry.contentLines.pop();
  }
  const rawContent = entry.contentLines.join("\n");
  const { body, tags } = parseTags(rawContent);
  return { id: entry.id, content: body, tags, date, time: entry.time };
}

function memoriesDir(brainPath: string): string {
  return join(brainPath, "memories");
}

function dailyFilePath(brainPath: string, date: string): string {
  return join(memoriesDir(brainPath), `${date}.md`);
}

function fileLockPath(brainPath: string, date: string): string {
  return join(memoriesDir(brainPath), `${date}.md.lock`);
}

export async function addMemory(
  brainPath: string,
  content: string,
  tags: string[],
  options?: { date?: string; time?: string; id?: string },
): Promise<Memory> {
  const now = new Date();
  const date =
    options?.date ?? now.toISOString().slice(0, 10);
  const time =
    options?.time ??
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const id = options?.id ?? generateId();

  const finalContent = tags.length > 0 ? appendTags(content, tags) : content;
  const entry = `## ${time} - ${id}\n${finalContent}\n\n`;

  const filePath = dailyFilePath(brainPath, date);
  const lock = fileLockPath(brainPath, date);

  await withLock(lock, async () => {
    let existing = "";
    try {
      existing = await readFile(filePath, "utf-8");
    } catch {}
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, existing + entry);
    renameSync(tmpPath, filePath);
  });

  const { body, tags: parsedTags } = parseTags(finalContent);
  return { id, content: body, tags: parsedTags, date, time };
}

export async function listMemories(
  brainPath: string,
  options?: {
    date?: string;
    from?: string;
    to?: string;
    tag?: string;
    limit?: number;
  },
): Promise<Memory[]> {
  const dir = memoriesDir(brainPath);
  if (!existsSync(dir)) return [];

  let files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.endsWith(".tmp"))
    .map((f) => f.replace(".md", ""))
    .sort();

  if (options?.date) files = files.filter((f) => f === options.date);
  if (options?.from) files = files.filter((f) => f >= options.from!);
  if (options?.to) files = files.filter((f) => f <= options.to!);

  const all: Memory[] = [];
  for (const date of files) {
    try {
      const raw = await readFile(dailyFilePath(brainPath, date), "utf-8");
      all.push(...parseJournal(raw, date));
    } catch {}
  }

  let result = all;
  if (options?.tag) {
    result = result.filter((m) => m.tags.includes(options.tag!));
  }

  result.sort((a, b) => {
    const cmp = b.date.localeCompare(a.date);
    if (cmp !== 0) return cmp;
    return b.time.localeCompare(a.time);
  });

  if (options?.limit && options.limit > 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}

export async function getMemory(
  brainPath: string,
  id: string,
): Promise<{ memory: Memory; date: string } | null> {
  const dir = memoriesDir(brainPath);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && !f.endsWith(".tmp"),
  );
  for (const file of files) {
    const date = file.replace(".md", "");
    const raw = await readFile(join(dir, file), "utf-8");
    const memories = parseJournal(raw, date);
    const found = memories.find((m) => m.id === id);
    if (found) return { memory: found, date };
  }
  return null;
}

export async function editMemory(
  brainPath: string,
  id: string,
  newContent: string,
): Promise<Memory> {
  const dir = memoriesDir(brainPath);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && !f.endsWith(".tmp"),
  );

  for (const file of files) {
    const date = file.replace(".md", "");
    const filePath = join(dir, file);
    const raw = await readFile(filePath, "utf-8");
    const memories = parseJournal(raw, date);
    const idx = memories.findIndex((m) => m.id === id);
    if (idx === -1) continue;

    const { body, tags } = parseTags(newContent);
    memories[idx] = { ...memories[idx], content: body, tags };

    const lock = fileLockPath(brainPath, date);
    await withLock(lock, async () => {
      const rebuilt = rebuildJournal(memories);
      const tmpPath = filePath + ".tmp";
      await writeFile(tmpPath, rebuilt);
      renameSync(tmpPath, filePath);
    });

    return memories[idx];
  }

  const err: any = new Error(`Memory ${id} not found.`);
  err.code = 2;
  throw err;
}

export async function deleteMemory(
  brainPath: string,
  id: string,
): Promise<void> {
  const dir = memoriesDir(brainPath);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && !f.endsWith(".tmp"),
  );

  for (const file of files) {
    const date = file.replace(".md", "");
    const filePath = join(dir, file);
    const raw = await readFile(filePath, "utf-8");
    const memories = parseJournal(raw, date);
    const idx = memories.findIndex((m) => m.id === id);
    if (idx === -1) continue;

    memories.splice(idx, 1);

    const lock = fileLockPath(brainPath, date);
    await withLock(lock, async () => {
      if (memories.length === 0) {
        try {
          unlinkSync(filePath);
        } catch {}
      } else {
        const rebuilt = rebuildJournal(memories);
        const tmpPath = filePath + ".tmp";
        await writeFile(tmpPath, rebuilt);
        renameSync(tmpPath, filePath);
      }
    });
    return;
  }

  const err: any = new Error(`Memory ${id} not found.`);
  err.code = 2;
  throw err;
}

function rebuildJournal(memories: Memory[]): string {
  return memories
    .map((m) => {
      let content = m.content;
      if (m.tags.length > 0) content += "\n" + formatTagLine(m.tags);
      return `## ${m.time} - ${m.id}\n${content}\n`;
    })
    .join("\n");
}
