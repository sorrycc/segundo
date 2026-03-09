#!/usr/bin/env bun

import { name, version } from "../package.json";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(`${name} ${version}`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`${name} ${version} - a zero-friction second brain

Usage:
  hmem <command> [options]

Commands:
  add <text>       Capture a thought
  search <query>   Search your memories
  list             List recent memories

Options:
  -h, --help       Show this help
  -v, --version    Show version`);
  process.exit(0);
}

console.log(`Unknown command: ${args[0]}. Run "hmem --help" for usage.`);
process.exit(1);
