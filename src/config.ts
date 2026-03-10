import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import type { Config } from "./types.js";

export function resolveBrainPath(opts: {
  brain?: string;
  profile?: string;
}): string {
  if (opts.brain) return opts.brain;
  if (opts.profile) return join(homedir(), `.segundo-${opts.profile}`);
  if (process.env.SEGUNDO_PATH) return process.env.SEGUNDO_PATH;
  return join(homedir(), ".segundo");
}

export async function loadConfig(brainPath: string): Promise<Config> {
  try {
    const raw = await readFile(join(brainPath, "config.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveConfig(
  brainPath: string,
  config: Config,
): Promise<void> {
  await writeFile(
    join(brainPath, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

export async function initBrain(
  brainPath: string,
  force?: boolean,
): Promise<void> {
  if (existsSync(brainPath) && !force) {
    throw new Error(
      `Brain already exists at ${brainPath}. Use --force to reinitialize.`,
    );
  }

  try {
    mkdirSync(join(brainPath, "memories"), { recursive: true });
    mkdirSync(join(brainPath, "embeddings"), { recursive: true });
  } catch (e: any) {
    throw new Error(
      `Failed to create brain at ${brainPath}: ${e.message}`,
    );
  }

  if (!existsSync(join(brainPath, "config.json")) || force) {
    await saveConfig(brainPath, {});
  }
}

export function ensureBrain(brainPath: string): void {
  if (!existsSync(brainPath)) {
    const err: any = new Error(
      'No brain found. Run "segundo init" to create one.',
    );
    err.code = 2;
    throw err;
  }
}
