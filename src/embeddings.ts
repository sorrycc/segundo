import { join } from "path";
import { existsSync, renameSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import type { Config, EmbeddingMeta, Memory, SearchResult } from "./types.js";
import { withLock } from "./lock.js";

function embeddingsDir(brainPath: string): string {
  return join(brainPath, "embeddings");
}

function indexPath(brainPath: string): string {
  return join(embeddingsDir(brainPath), "index.bin");
}

function metaPath(brainPath: string): string {
  return join(embeddingsDir(brainPath), "meta.json");
}

function indexLockPath(brainPath: string): string {
  return join(embeddingsDir(brainPath), "index.lock");
}

export function isProviderConfigured(config: Config): boolean {
  return !!config.embeddings?.provider;
}

export async function embed(config: Config, text: string): Promise<Float32Array> {
  const provider = config.embeddings?.provider;
  const model = config.embeddings?.model;

  if (provider === "ollama") {
    const url = config.embeddings?.ollamaUrl ?? "http://localhost:11434";
    const res = await fetch(`${url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model ?? "nomic-embed-text", input: text }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
    const data = await res.json();
    return new Float32Array(data.embeddings[0]);
  }

  if (provider === "openai") {
    const apiKey = config.embeddings?.openaiApiKey?.startsWith("$")
      ? process.env[config.embeddings.openaiApiKey.slice(1)]
      : config.embeddings?.openaiApiKey;
    if (!apiKey) throw new Error("OpenAI API key not configured");

    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model ?? "text-embedding-3-small",
        input: text,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.statusText}`);
    const data = await res.json();
    return new Float32Array(data.data[0].embedding);
  }

  throw new Error("No embedding provider configured");
}

async function loadMeta(brainPath: string): Promise<EmbeddingMeta> {
  try {
    const raw = await readFile(metaPath(brainPath), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { dimension: 0, entries: [] };
  }
}

async function saveMeta(
  brainPath: string,
  meta: EmbeddingMeta,
): Promise<void> {
  const path = metaPath(brainPath);
  const tmpPath = path + ".tmp";
  await writeFile(tmpPath, JSON.stringify(meta, null, 2) + "\n");
  renameSync(tmpPath, path);
}

export async function addEmbedding(
  brainPath: string,
  config: Config,
  id: string,
  content: string,
): Promise<void> {
  const vector = await embed(config, content);
  const lock = indexLockPath(brainPath);

  await withLock(lock, async () => {
    const meta = await loadMeta(brainPath);
    if (meta.dimension === 0) meta.dimension = vector.length;

    const pos = meta.entries.length;
    meta.entries.push({ pos, id });

    const binPath = indexPath(brainPath);
    const existing = existsSync(binPath)
      ? new Uint8Array(await readFile(binPath))
      : new Uint8Array(0);
    const vectorBytes = new Uint8Array(vector.buffer);
    const combined = new Uint8Array(existing.length + vectorBytes.length);
    combined.set(existing, 0);
    combined.set(vectorBytes, existing.length);
    await writeFile(binPath, combined);

    await saveMeta(brainPath, meta);
  });
}

export async function deleteEmbedding(
  brainPath: string,
  id: string,
): Promise<void> {
  const lock = indexLockPath(brainPath);
  await withLock(lock, async () => {
    const meta = await loadMeta(brainPath);
    const entry = meta.entries.find((e) => e.id === id);
    if (entry) {
      entry.deleted = true;
      await saveMeta(brainPath, meta);
    }
  });
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function semanticSearch(
  brainPath: string,
  config: Config,
  query: string,
  memories: Memory[],
  limit: number = 10,
): Promise<SearchResult[]> {
  const queryVector = await embed(config, query);
  const meta = await loadMeta(brainPath);
  if (meta.dimension === 0 || meta.entries.length === 0) return [];

  const binPath = indexPath(brainPath);
  if (!existsSync(binPath)) return [];

  const buf = await readFile(binPath);
  const allVectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const memoryMap = new Map(memories.map((m) => [m.id, m]));

  const scored: SearchResult[] = [];
  for (const entry of meta.entries) {
    if (entry.deleted) continue;
    const memory = memoryMap.get(entry.id);
    if (!memory) continue;

    const offset = entry.pos * meta.dimension;
    const vector = allVectors.slice(offset, offset + meta.dimension);
    const score = cosineSimilarity(queryVector, vector);
    scored.push({ memory, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function reindex(
  brainPath: string,
  config: Config,
  memories: Memory[],
): Promise<void> {
  const lock = indexLockPath(brainPath);
  await withLock(lock, async () => {
    const vectors: Float32Array[] = [];
    const entries: EmbeddingMeta["entries"] = [];

    for (const m of memories) {
      try {
        const vector = await embed(config, m.content);
        entries.push({ pos: vectors.length, id: m.id });
        vectors.push(vector);
      } catch (e: any) {
        console.error(`Failed to embed ${m.id}: ${e.message}`);
      }
    }

    if (vectors.length === 0) {
      await writeFile(indexPath(brainPath), new Uint8Array(0));
      await saveMeta(brainPath, { dimension: 0, entries: [] });
      return;
    }

    const dimension = vectors[0].length;
    const buf = new Float32Array(vectors.length * dimension);
    for (let i = 0; i < vectors.length; i++) {
      buf.set(vectors[i], i * dimension);
    }

    await writeFile(indexPath(brainPath), new Uint8Array(buf.buffer));
    await saveMeta(brainPath, { dimension, entries });
  });
}
