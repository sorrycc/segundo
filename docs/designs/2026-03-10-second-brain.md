# segundo — AI-first Second Brain CLI

## Overview

A zero-friction CLI for capturing and retrieving thoughts, optimized for AI agent consumption. Memories are stored as daily markdown journal files with semantic search powered by pluggable embedding providers.

## Phases

| Phase | Scope | Commands |
|-------|-------|----------|
| **1 — MVP** | Core capture & retrieval, text search, tag parsing, error handling | `init`, `add`, `list`, `search` (text fallback) |
| **2 — Semantic** | Embedding providers, vector index, cosine similarity search | `search` (semantic), `init --reindex` |
| **3 — Edit/Batch** | Mutation commands, batch operations, file locking | `edit`, `delete`, batch variants |
| **4 — IO** | Bulk import/export, brain statistics | `import`, `export`, `stats` |

## Storage Model [Phase 1]

- **Location**: `$HOME/.segundo/` by default (configurable via `--profile`, `--brain`, or `SEGUNDO_PATH`)
- **Layout**:
  ```
  $HOME/.segundo/
    config.json
    memories/
      2026-03-10.md
      2026-03-09.md
      2026-03-10.md.lock    # transient, per-file write lock [Phase 3]
    embeddings/                                                [Phase 2]
      index.bin             # flat float32 vectors, append-only
      meta.json             # vector position → memory ID mapping
      index.lock            # transient, whole-index write lock
  ```
- **Daily journal format**:
  ```markdown
  ## 14:30 - a1b2c3d4
  read Designing Data-Intensive Applications
  this is a multi-line thought
  that continues here
  #book #engineering

  ## 14:31 - e5f6g7h8
  John recommended restaurant on 5th
  #food #recommendation
  ```
- Each entry: `## HH:MM - <id>` header, content (supports multiple lines), optional trailing tag line
- Entry boundary: next `## HH:MM` header or EOF

## Tag Parsing [Phase 1]

Tags are extracted from the **last line** of an entry only if that line consists entirely of space-separated `#tag` tokens.

**Rules:**
- Tag name regex: `[a-zA-Z][a-zA-Z0-9_-]*`
- The last line must match: `^(#[a-zA-Z][a-zA-Z0-9_-]*\s*)+$`
- If the last line contains any non-tag content, no tags are extracted from that entry
- Content body can freely contain `#` characters (URLs, headings, issue numbers) without false matches

**Examples:**
```
## 14:30 - a1b2c3d4
read chapter on consistency #great    <-- NOT a tag line (mixed content)

## 14:31 - e5f6g7h8
read chapter on consistency
#book #engineering                    <-- tag line: ["book", "engineering"]

## 14:32 - i9j0k1l2
see issue #42 for details             <-- no tags (last line has non-tag content)
```

**CLI `--tag` flag:** `segundo add "thought" --tag foo` appends `#foo` to a trailing tag line, creating one if absent.

## ID Schema [Phase 1]

8-character nanoid using alphanumeric charset (`[a-zA-Z0-9]`), 62^8 = ~218 trillion combinations. Generated via `crypto.getRandomValues` + base62 encoding. No external dependency.

## Brain Path Resolution [Phase 1]

Priority order (highest wins):
1. `--brain <path>` flag — explicit arbitrary path
2. `--profile <name>` flag — resolves to `$HOME/.segundo-<name>/`
3. `SEGUNDO_PATH` environment variable
4. Default: `$HOME/.segundo/`

**Profile examples:**
```
segundo add "thought"                    → $HOME/.segundo/
segundo --profile work add "thought"     → $HOME/.segundo-work/
segundo --profile personal list          → $HOME/.segundo-personal/
segundo --brain /tmp/test add "thought"  → /tmp/test/
```

Config file (`config.json`) remains brain-local — stored inside the brain directory.

## Commands

### Phase 1 — MVP

| Command | Usage | Description |
|---------|-------|-------------|
| `init` | `segundo init [--profile name] [--brain path]` | Create brain directory, configure embedding provider |
| `add` | `segundo add "thought" [--tag foo]` | Capture a memory |
| `search` | `segundo search "query" [--limit N] [--from DATE] [--to DATE]` | Text search (substring, case-insensitive) |
| `list` | `segundo list [--date DATE] [--from DATE] [--to DATE] [--tag foo] [--limit N]` | List memories, newest first |

### Phase 2 — Semantic Search

| Command | Usage | Description |
|---------|-------|-------------|
| `search` | `segundo search "query" [--limit N] [--from DATE] [--to DATE]` | Semantic search (upgrades text search when provider configured) |
| `init` | `segundo init --reindex` | Regenerate all embeddings and compact index |

### Phase 3 — Edit/Batch

| Command | Usage | Description |
|---------|-------|-------------|
| `edit` | `segundo edit <id> "new content"` | Replace memory content by ID |
| `edit` (batch) | `segundo edit id1 "c1" id2 "c2"` | Edit multiple (alternating id/content pairs) |
| `delete` | `segundo delete <id> [id2 id3...]` | Remove one or more memories by ID |
| `add` (batch) | `segundo add "t1" "t2" "t3"` | Capture multiple memories |
| `add` (stdin) | `echo "thought" \| segundo add` | Capture from stdin |
| `add` (stdin batch) | `cat file \| segundo add --batch` | One memory per blank-line-separated block |

### Phase 4 — IO

| Command | Usage | Description |
|---------|-------|-------------|
| `import` | `segundo import <file-or-dir> [...]` | Import .md/.txt files as memories |
| `export` | `segundo export [--format md\|json] [--from DATE] [--to DATE] [--tag foo]` | Export memories to stdout |
| `stats` | `segundo stats` | Show brain statistics |

All commands support `--json` for structured output, `--brain <path>` for explicit brain location, and `--profile <name>` for named profiles.

### Multi-line Content [Phase 1]

- Quoted arg: `segundo add "line1\nline2"` — `\n` is interpreted as newline
- Stdin: pipe content or use `segundo add -` as explicit stdin marker
- If stdin is a pipe (not a TTY), read from it automatically

### Batch Operations [Phase 3]

All write commands accept multiple operands:
- **add**: each positional arg becomes a separate memory; with `--batch` stdin, split on blank lines
- **delete**: `segundo delete id1 id2 id3` — partial failure reports which IDs weren't found, still deletes the rest
- **edit**: `segundo edit id1 "content1" id2 "content2"` — alternating id/content pairs, errors on odd arg count

Batch `--json` output: array of `{ id, status: "ok" | "error", error? }` per operation.

### Import [Phase 4]

`segundo import <file-or-dir> [file-or-dir...]`

- **Files**: each `.md`/`.txt` file becomes one memory, timestamp from file mtime
- **Directories**: recursive walk, imports all `.md`/`.txt` files, skips others with stderr warning
- Generates new nanoid per imported memory
- Appends to daily journal file based on mtime date
- Embeddings computed and appended incrementally
- `--tag foo` applies tag to all imported files
- `--dry-run` prints what would be imported without writing
- No duplicate detection — user's responsibility

### Export [Phase 4]

`segundo export [--format md|json] [--from DATE] [--to DATE] [--tag foo]`

- **Markdown** (default): concatenates daily journal files in chronological order
- **JSON**: array of memory objects with all metadata
- Writes to stdout (pipe to file)
- Date range and tag filters apply

### Stats [Phase 4]

`segundo stats` — prints:
- Total memory count
- Date range (oldest to newest)
- Tag frequency (top 10)
- Embedding index size (vector count, file size)
- Brain path

## Error Handling [Phase 1]

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error (invalid args, IO failure, lock timeout) |
| `2` | Not found (brain dir missing, memory ID not found) |

### Error Output

- Errors are written to **stderr**, data to **stdout**
- With `--json`: errors are `{ "error": "<message>", "code": <exit_code> }`
- Batch operations with `--json`: array of `{ "id": "<id>", "status": "ok" | "error", "error?": "<message>" }`

### Error Table

| Command | Failure | Message | Exit |
|---------|---------|---------|------|
| *any* | Brain dir missing | `No brain found. Run "segundo init" to create one.` | 2 |
| *any* | Invalid arguments | `<specific usage hint>` | 1 |
| `init` | Brain already exists | `Brain already exists at <path>. Use --force to reinitialize.` | 1 |
| `init` | Cannot create directory | `Failed to create brain at <path>: <os error>` | 1 |
| `add` | Empty content | `Nothing to add. Provide text as argument or pipe via stdin.` | 1 |
| `add` | Lock timeout | `Could not acquire lock on <file>. Another process may be writing.` | 1 |
| `add` | Write failure | `Failed to write memory: <os error>` | 1 |
| `search` | No results | *(exit 0, empty output)* | 0 |
| `search` | No provider configured | `No embedding provider configured. Using text search. Run "segundo init" to configure.` (stderr warning, still runs text fallback) | 0 |
| `search` | Provider unreachable | `Embedding provider unreachable at <url>. Falling back to text search.` (stderr warning) | 0 |
| `list` | No memories in range | *(exit 0, empty output)* | 0 |
| `edit` | ID not found | `Memory <id> not found.` | 2 |
| `edit` | Odd arg count | `Edit requires alternating id/content pairs. Got <n> arguments.` | 1 |
| `delete` | ID not found | `Memory <id> not found.` (partial: continues with remaining IDs) | 2 |
| `delete` | Lock timeout | `Could not acquire lock on <file>. Another process may be writing.` | 1 |
| `import` | File not found | `File not found: <path>` | 2 |
| `import` | Unsupported format | `Skipping <path>: unsupported file type` (stderr warning, continues) | 0 |
| `export` | No memories match | *(exit 0, empty output)* | 0 |

## Semantic Search [Phase 2]

Inspired by [memsearch](https://github.com/zilliztech/memsearch) — lightweight memory search for AI agents.

- Embeddings stored in `.segundo/embeddings/` as flat float32 binary + JSON metadata
- On `add`: embed content, append vector to `index.bin`
- On `search`: embed query, cosine similarity, return top-N results
- **Date range filtering**: `--from` / `--to` (inclusive) restrict which memories are scored
- Fallback: case-insensitive substring match when no provider configured
- Rebuild: `segundo init --reindex` regenerates all embeddings and compacts index

### Incremental Index [Phase 2]

`index.bin` is append-only. `meta.json` tracks vector positions:

```json
{
  "dimension": 768,
  "entries": [
    { "pos": 0, "id": "a1b2c3d4" },
    { "pos": 1, "id": "e5f6g7h8", "deleted": true }
  ]
}
```

- **Add**: append vector to `index.bin`, append entry to `meta.json`
- **Delete/Edit**: mark entry `"deleted": true` in `meta.json`, skip during search
- **Compaction**: `segundo init --reindex` rebuilds both files, removes deleted entries

### Providers [Phase 2]

- **Ollama**: `POST http://localhost:11434/api/embed` — local, free, offline
- **OpenAI-compatible**: `POST <openaiBaseUrl>/embeddings` (defaults to `https://api.openai.com/v1`) — cloud, requires API key

### Config [Phase 1]

```json
{
  "embeddings": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "ollamaUrl": "http://localhost:11434",
    "openaiApiKey": "$OPENAI_API_KEY",
    "openaiBaseUrl": "https://api.openai.com/v1"
  }
}
```

## File Locking [Phase 3]

Concurrent CLI invocations are safe via lockfiles:

**Per-file locks for daily memory files**: Write operations acquire `<brain>/memories/<date>.md.lock` using `O_CREAT | O_EXCL` for atomic creation. Retry with exponential backoff (3 attempts). Stale lock detection: force-remove if lockfile older than 30 seconds.

**Whole-brain lock for embeddings**: Write operations touching the index acquire `<brain>/embeddings/index.lock`. Same mechanism. Serializes all embedding writes.

**Read operations** (`search`, `list`) do not acquire locks — writes must use atomic rename (write to temp file, then rename into place) to ensure readers never see partial state.

## Architecture [Phase 1+]

Flat module structure, one file per concern:

```
src/
  cli.ts          # arg parsing + command dispatch                [Phase 1]
  store.ts        # CRUD on daily markdown files                  [Phase 1]
  search.ts       # text search, date range filtering             [Phase 1]
  config.ts       # init, load/save config, brain path resolution [Phase 1]
  tags.ts         # tag parsing from trailing line                [Phase 1]
  types.ts        # Memory, Config, SearchResult types            [Phase 1]
  embeddings.ts   # ollama/openai provider, incremental index     [Phase 2]
  lock.ts         # file locking primitives                       [Phase 3]
  import.ts       # file/directory import logic                   [Phase 4]
  export.ts       # markdown/json export                          [Phase 4]
  stats.ts        # brain statistics                              [Phase 4]
```

## Design Decisions

- **AI-first**: optimized for programmatic use by AI agents, not human interactive use
- **No $EDITOR**: edit command takes new content as argument
- **No external vector DB**: cosine similarity on flat float32 arrays — sufficient for personal memory scale (~50K memories)
- **Zero runtime deps**: Bun provides fetch, fs, crypto built-in
- **Markdown storage**: human-readable, git-friendly, grep-friendly
- **Daily journal files**: natural chronological grouping, fewer files than one-per-memory
- **Trailing-line tags**: `#tag` only on the last line of an entry — zero false positives from URLs, code, or issue numbers
- **Output modes**: plain text default (AI reads it fine), `--json` flag for structured consumption
- **Append-only embeddings**: incremental writes avoid reindexing on every add, compaction via `--reindex`
- **Lockfiles over flock**: portable, works across all platforms Bun supports, visible for debugging
- **Atomic writes for readers**: write to temp + rename ensures lockless reads never see partial state
- **$HOME default**: brain lives in `$HOME/.segundo/`, not CWD — consistent regardless of working directory
- **Profiles over paths**: `--profile work` is more ergonomic than `--brain ~/.segundo-work` for common multi-brain use cases
- **Graceful search degradation**: semantic search falls back to text search when provider is unreachable, with stderr warning
