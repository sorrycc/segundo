import { join, extname } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { readFile } from "fs/promises";
import type { Config, BatchResult } from "./types.js";
import { addMemory } from "./store.js";
import { addEmbedding, isProviderConfigured } from "./embeddings.js";

interface ImportOptions {
  tag?: string;
  dryRun?: boolean;
  brainPath: string;
  config: Config;
}

export async function importFiles(
  paths: string[],
  options: ImportOptions,
): Promise<BatchResult[]> {
  const filesToImport = collectFiles(paths);
  const results: BatchResult[] = [];

  for (const filePath of filesToImport) {
    if (options.dryRun) {
      console.error(`Would import: ${filePath}`);
      results.push({ id: "", status: "ok" });
      continue;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const stat = statSync(filePath);
      const mtime = new Date(stat.mtimeMs);
      const date = mtime.toISOString().slice(0, 10);
      const time = `${String(mtime.getHours()).padStart(2, "0")}:${String(mtime.getMinutes()).padStart(2, "0")}`;
      const tags = options.tag ? [options.tag] : [];

      const memory = await addMemory(options.brainPath, content.trim(), tags, {
        date,
        time,
      });

      if (isProviderConfigured(options.config)) {
        try {
          await addEmbedding(
            options.brainPath,
            options.config,
            memory.id,
            memory.content,
          );
        } catch {}
      }

      results.push({ id: memory.id, status: "ok" });
    } catch (e: any) {
      results.push({ id: "", status: "error", error: e.message });
    }
  }

  return results;
}

function collectFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      continue;
    }
    const stat = statSync(p);
    if (stat.isDirectory()) {
      walkDir(p, files);
    } else if (isSupported(p)) {
      files.push(p);
    } else {
      console.error(`Skipping ${p}: unsupported file type`);
    }
  }
  return files;
}

function walkDir(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (isSupported(entry.name)) {
      files.push(full);
    } else {
      console.error(`Skipping ${full}: unsupported file type`);
    }
  }
}

function isSupported(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return ext === ".md" || ext === ".txt";
}
