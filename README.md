# segundo

[![npm version](https://img.shields.io/npm/v/segundo.svg)](https://www.npmjs.com/package/segundo)
[![npm downloads](https://img.shields.io/npm/dm/segundo.svg)](https://www.npmjs.com/package/segundo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A zero-friction CLI for capturing and retrieving thoughts. Memories are stored as daily markdown journals with optional semantic search. Built with TypeScript, runs on Bun.

## Install

```bash
npm install -g segundo
```

## Quick Start

```bash
# Create your brain
segundo init

# Capture thoughts
segundo add "read Designing Data-Intensive Applications" --tag book
segundo add "John recommended restaurant on 5th" --tag food

# Search
segundo search "restaurant"

# List recent memories
segundo list --limit 5
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Create a new brain |
| `add <text>` | Capture a memory |
| `search <query>` | Search memories (semantic or text) |
| `list` | List memories, newest first |
| `edit <id> <text>` | Replace a memory's content |
| `delete <id>` | Delete one or more memories |
| `import <path>` | Import .md/.txt files as memories |
| `export` | Export memories to stdout |
| `stats` | Show brain statistics |

## Tags

Tags go on the last line of an entry. Add via `--tag` flag or inline:

```bash
segundo add "great chapter on consistency\n#book #engineering"
segundo add "lunch spot" --tag food
```

## Filtering

```bash
segundo list --tag book
segundo list --from 2026-03-01 --to 2026-03-10
segundo search "data" --limit 5 --from 2026-01-01
```

## Multi-line & Stdin

```bash
# Escaped newlines
segundo add "line one\nline two"

# Pipe from stdin
echo "thought from pipe" | segundo add

# Batch from stdin (split on blank lines)
cat notes.txt | segundo add --batch
```

## Batch Operations

```bash
segundo add "thought one" "thought two" "thought three"
segundo delete id1 id2 id3
segundo edit id1 "new content" id2 "other content"
```

## Profiles

```bash
segundo --profile work add "quarterly review notes"
segundo --profile personal add "book recommendation"
segundo --brain /custom/path list
```

## Semantic Search

Configure an embedding provider in `~/.segundo/config.json`:

```json
{
  "embeddings": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "ollamaUrl": "http://localhost:11434"
  }
}
```

Supports **Ollama** (local, free) and **OpenAI** (cloud, requires API key). Falls back to text search when unavailable.

Rebuild the index anytime with `segundo init --reindex`.

## JSON Output

All commands support `--json` for structured output:

```bash
segundo list --json
segundo add "thought" --json
```

## Storage

Memories live in `~/.segundo/memories/` as daily markdown files:

```
~/.segundo/
  config.json
  memories/
    2026-03-10.md
  embeddings/
    index.bin
    meta.json
```

## License

[MIT](./LICENSE)
