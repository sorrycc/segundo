#!/usr/bin/env node

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import yargsParser from "yargs-parser";
import { resolveBrainPath, loadConfig, initBrain, ensureBrain } from "./config.js";
import { addMemory, listMemories, editMemory, deleteMemory, getMemory } from "./store.js";
import { textSearch } from "./search.js";
import {
  addEmbedding,
  deleteEmbedding,
  semanticSearch,
  reindex,
  isProviderConfigured,
} from "./embeddings.js";
import { importFiles } from "./import.js";
import { exportMemories } from "./export.js";
import { getStats } from "./stats.js";
import { formatTagLine, appendTags, removeTags } from "./tags.js";
import type { Memory, BatchResult } from "./types.js";

function findPackageJson(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("package.json not found");
}
const { name, version } = JSON.parse(readFileSync(findPackageJson(), "utf-8"));

// --- Arg parsing ---

const argv = yargsParser(process.argv.slice(2), {
  string: ["brain", "profile", "from", "to", "date", "format"],
  boolean: ["json", "help", "version", "force", "reindex", "batch", "dry-run"],
  array: ["tag", "untag"],
  alias: { v: "version", h: "help" },
});

const jsonOutput = !!argv.json;

// --- Output helpers ---

function error(message: string, code: number = 1): never {
  if (jsonOutput) {
    console.log(JSON.stringify({ error: message, code }));
  } else {
    console.error(message);
  }
  process.exit(code);
}

function output(data: unknown): void {
  if (jsonOutput) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === "string") {
    console.log(data);
  }
}

function formatMemory(m: Memory): string {
  let s = `[${m.date} ${m.time}] ${m.id}\n${m.content}`;
  if (m.tags.length > 0) s += "\n" + formatTagLine(m.tags);
  return s;
}

function formatMemories(memories: Memory[]): string {
  return memories.map(formatMemory).join("\n\n");
}

// --- Stdin helper ---

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

// --- Version / Help ---

if (argv.version) {
  console.log(`${name} ${version}`);
  process.exit(0);
}

const command = argv._[0] ? String(argv._[0]) : undefined;
const args = argv._.slice(1).map(String);

if (argv.help || !command) {
  console.log(`${name} ${version} - AI-first second brain CLI

Usage:
  segundo [flags] <command> [args]

Commands:
  init                Create a new brain
  add <text>          Capture a memory
  search <query>      Search memories
  list                List memories
  edit <id> [text]    Edit a memory (--tag/--untag)
  delete <id>         Delete memories
  import <path>       Import files as memories
  export              Export memories
  stats               Show brain statistics

Global flags:
  --brain <path>      Use brain at specific path
  --profile <name>    Use named profile (~/.segundo-<name>)
  --json              Output as JSON
  -h, --help          Show help
  -v, --version       Show version`);
  process.exit(0);
}

// --- Brain path ---

const brainPath = resolveBrainPath({
  brain: argv.brain,
  profile: argv.profile,
});

// --- Command dispatch ---

try {
  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "add":
      await cmdAdd();
      break;
    case "search":
      await cmdSearch();
      break;
    case "list":
      await cmdList();
      break;
    case "edit":
      await cmdEdit();
      break;
    case "delete":
      await cmdDelete();
      break;
    case "import":
      await cmdImport();
      break;
    case "export":
      await cmdExport();
      break;
    case "stats":
      await cmdStats();
      break;
    default:
      error(`Unknown command: ${command}. Run "segundo --help" for usage.`, 1);
  }
} catch (e: any) {
  error(e.message ?? String(e), e.code ?? 1);
}

// --- Command handlers ---

async function cmdInit() {
  const force = !!argv.force;
  const doReindex = !!argv.reindex;

  if (doReindex) {
    ensureBrain(brainPath);
    const config = await loadConfig(brainPath);
    if (!isProviderConfigured(config)) {
      error("No embedding provider configured. Cannot reindex.", 1);
    }
    const memories = await listMemories(brainPath);
    console.error(`Reindexing ${memories.length} memories...`);
    await reindex(brainPath, config, memories);
    output(jsonOutput ? { status: "ok", reindexed: memories.length } : `Reindexed ${memories.length} memories.`);
    return;
  }

  await initBrain(brainPath, force);
  output(jsonOutput ? { status: "ok", path: brainPath } : `Brain created at ${brainPath}`);
}

async function cmdAdd() {
  ensureBrain(brainPath);

  const tag = argv.tag?.[0];
  const tags = tag ? [tag] : [];
  const isBatch = !!argv.batch;

  // Collect content from args or stdin
  let contents: string[] = [];

  if (args.length > 0 && args[0] !== "-") {
    contents = args.map((a) => a.replace(/\\n/g, "\n"));
  } else if (!process.stdin.isTTY || args[0] === "-") {
    const stdin = await readStdin();
    if (isBatch) {
      contents = stdin
        .split(/\n\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      contents = [stdin.trim()];
    }
  }

  if (contents.length === 0 || contents.every((c) => !c)) {
    error("Nothing to add. Provide text as argument or pipe via stdin.", 1);
  }

  const config = await loadConfig(brainPath);
  const hasEmbeddings = isProviderConfigured(config);
  const results: Array<Memory | BatchResult> = [];

  for (const content of contents) {
    if (!content) continue;
    try {
      const memory = await addMemory(brainPath, content, tags);
      if (hasEmbeddings) {
        try {
          await addEmbedding(brainPath, config, memory.id, memory.content);
        } catch {}
      }
      results.push(memory);
    } catch (e: any) {
      results.push({ id: "", status: "error", error: e.message });
    }
  }

  if (contents.length === 1 && results.length === 1) {
    const r = results[0];
    if ("status" in r) error(r.error ?? "Failed to add memory.", 1);
    if (jsonOutput) {
      output(r);
    } else {
      console.log(r.id);
    }
  } else {
    if (jsonOutput) {
      output(
        results.map((r) =>
          "status" in r ? r : { id: r.id, status: "ok" },
        ),
      );
    } else {
      for (const r of results) {
        console.log("id" in r && !("status" in r) ? r.id : `error: ${"error" in r ? r.error : "unknown"}`);
      }
    }
  }
}

async function cmdSearch() {
  ensureBrain(brainPath);

  const query = args[0];
  if (!query) error("Usage: segundo search <query>", 1);

  const limit = argv.limit ? Number(argv.limit) : 10;
  const from = argv.from;
  const to = argv.to;

  const memories = await listMemories(brainPath, { from, to });
  const config = await loadConfig(brainPath);

  let results;
  if (isProviderConfigured(config)) {
    try {
      results = await semanticSearch(brainPath, config, query, memories, limit);
    } catch (e: any) {
      const url = config.embeddings?.ollamaUrl ?? config.embeddings?.provider;
      console.error(
        `Embedding provider unreachable at ${url}. Falling back to text search.`,
      );
      results = textSearch(memories, query, limit);
    }
  } else {
    console.error(
      'No embedding provider configured. Using text search. Run "segundo init" to configure.',
    );
    results = textSearch(memories, query, limit);
  }

  if (jsonOutput) {
    output(results);
  } else {
    if (results.length === 0) return;
    console.log(formatMemories(results.map((r) => r.memory)));
  }
}

async function cmdList() {
  ensureBrain(brainPath);

  const date = argv.date;
  const from = argv.from;
  const to = argv.to;
  const tag = argv.tag?.[0];
  const limit = argv.limit ? Number(argv.limit) : undefined;

  const memories = await listMemories(brainPath, { date, from, to, tag, limit });

  if (jsonOutput) {
    output(memories);
  } else {
    if (memories.length === 0) return;
    console.log(formatMemories(memories));
  }
}

async function cmdEdit() {
  ensureBrain(brainPath);

  const addTags: string[] = argv.tag ?? [];
  const rmTags: string[] = argv.untag ?? [];
  const hasTags = addTags.length > 0 || rmTags.length > 0;

  if (args.length === 0) error("Usage: segundo edit <id> [content] [--tag <tag>] [--untag <tag>]", 1);

  // Determine if we have id/content pairs or tag-only edits
  const hasContent = args.length >= 2;

  if (hasContent && args.length % 2 !== 0) {
    error(
      `Edit requires alternating id/content pairs. Got ${args.length} arguments.`,
      1,
    );
  }

  if (!hasContent && !hasTags) {
    error("Nothing to edit. Provide content or --tag/--untag flags.", 1);
  }

  const config = await loadConfig(brainPath);
  const hasEmbeddings = isProviderConfigured(config);
  const results: BatchResult[] = [];

  if (hasContent) {
    // id/content pairs, optionally with --tag/--untag
    for (let i = 0; i < args.length; i += 2) {
      const id = args[i];
      let content = args[i + 1].replace(/\\n/g, "\n");
      content = appendTags(content, addTags);
      content = removeTags(content, rmTags);
      try {
        const memory = await editMemory(brainPath, id, content);
        if (hasEmbeddings) {
          try {
            await deleteEmbedding(brainPath, id);
            await addEmbedding(brainPath, config, id, memory.content);
          } catch {}
        }
        results.push({ id, status: "ok" });
      } catch (e: any) {
        results.push({ id, status: "error", error: e.message });
      }
    }
  } else {
    // Tag-only edits: each arg is an id
    for (const id of args) {
      try {
        const found = await getMemory(brainPath, id);
        if (!found) {
          const err: any = new Error(`Memory ${id} not found.`);
          err.code = 2;
          throw err;
        }
        let content = found.memory.content;
        if (found.memory.tags.length > 0) {
          content += "\n" + formatTagLine(found.memory.tags);
        }
        content = appendTags(content, addTags);
        content = removeTags(content, rmTags);
        const memory = await editMemory(brainPath, id, content);
        if (hasEmbeddings) {
          try {
            await deleteEmbedding(brainPath, id);
            await addEmbedding(brainPath, config, id, memory.content);
          } catch {}
        }
        results.push({ id, status: "ok" });
      } catch (e: any) {
        results.push({ id, status: "error", error: e.message });
      }
    }
  }

  if (results.length === 1) {
    const r = results[0];
    if (r.status === "error") error(r.error!, (r as any).code ?? 2);
    if (jsonOutput) output(r);
    else console.log(r.id);
  } else {
    if (jsonOutput) {
      output(results);
    } else {
      for (const r of results) {
        console.log(r.status === "ok" ? r.id : `error: ${r.error}`);
      }
    }
  }
}

async function cmdDelete() {
  ensureBrain(brainPath);

  if (args.length === 0) error("Usage: segundo delete <id> [id...]", 1);

  const config = await loadConfig(brainPath);
  const hasEmbeddings = isProviderConfigured(config);
  const results: BatchResult[] = [];
  let hasError = false;

  for (const id of args) {
    try {
      await deleteMemory(brainPath, id);
      if (hasEmbeddings) {
        try {
          await deleteEmbedding(brainPath, id);
        } catch {}
      }
      results.push({ id, status: "ok" });
    } catch (e: any) {
      hasError = true;
      results.push({ id, status: "error", error: e.message });
    }
  }

  if (jsonOutput) {
    output(results);
  } else {
    for (const r of results) {
      if (r.status === "error") console.error(r.error);
      else console.log(r.id);
    }
  }

  if (hasError) process.exit(2);
}

async function cmdImport() {
  ensureBrain(brainPath);

  if (args.length === 0) error("Usage: segundo import <path> [path...]", 1);

  const config = await loadConfig(brainPath);
  const tag = argv.tag?.[0];
  const dryRun = !!argv["dry-run"];

  const results = await importFiles(args, {
    tag,
    dryRun,
    brainPath,
    config,
  });

  if (jsonOutput) {
    output(results);
  } else {
    const ok = results.filter((r) => r.status === "ok").length;
    const fail = results.filter((r) => r.status === "error").length;
    console.log(`Imported ${ok} file(s)${fail > 0 ? `, ${fail} failed` : ""}`);
  }
}

async function cmdExport() {
  ensureBrain(brainPath);

  const format =
    argv.format === "json" ? "json" : ("md" as "md" | "json");
  const from = argv.from;
  const to = argv.to;
  const tag = argv.tag?.[0];

  const result = await exportMemories({ format, from, to, tag, brainPath });
  if (result) process.stdout.write(result);
}

async function cmdStats() {
  ensureBrain(brainPath);

  const stats = await getStats(brainPath);

  if (jsonOutput) {
    output(stats);
    return;
  }

  console.log(`Brain: ${stats.brainPath}`);
  console.log(`Memories: ${stats.totalMemories}`);

  if (stats.dateRange) {
    console.log(
      `Date range: ${stats.dateRange.oldest} to ${stats.dateRange.newest}`,
    );
  }

  if (stats.topTags.length > 0) {
    console.log("Top tags:");
    for (const { tag, count } of stats.topTags) {
      console.log(`  #${tag} (${count})`);
    }
  }

  if (stats.embeddingIndex) {
    const kb = (stats.embeddingIndex.fileSize / 1024).toFixed(1);
    console.log(
      `Embeddings: ${stats.embeddingIndex.vectorCount} vectors, ${kb} KB`,
    );
  }
}
