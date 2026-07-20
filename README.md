# @memex/openclaw-memex — MeMex Zero RAG ContextEngine Plugin

> Durable, anti-hallucination wiki memory for OpenClaw agents. Injects compiled knowledge from MeMex Zero RAG's wiki into every assembly pass.

## What It Does

OpenClaw agents lose context between sessions like everyone else. This plugin solves that by connecting OpenClaw to **MeMex Zero RAG** — a structured wiki knowledge system with built-in anti-hallucination, knowledge decay, and conflict detection.

Every time OpenClaw assembles context for a reply, the plugin:

1. **Searches the MeMex wiki** for relevant entries based on conversation context
2. **Injects matched knowledge** as a system prompt supplement
3. **Respects knowledge decay** — expired entries automatically deprioritize
4. **Flags conflicts** — duplicate or contradictory entries are reported on bootstrap

The result: your agent never forgets documented decisions, and never hallucinates institutional knowledge it should have known.

## Requirements

| Requirement | Version |
|---|---|
| OpenClaw Gateway | ≥ 2026.5.28 |
| Node.js | ≥ 22 |

## Installation

```bash
openclaw plugins install @memex/openclaw-memex
```

Or from a local build:

```bash
cd /path/to/memex-openclaw-plugin
pnpm build
openclaw plugins install --link /path/to/memex-openclaw-plugin
```

Restart the gateway:

```bash
openclaw gateway restart
```

## Configuration

The plugin is configured via `plugins.entries.memex-openclaw` in your `openclaw.json`:

```json5
{
  "plugins": {
    "slots": {
      "contextEngine": "memex-openclaw"
    },
    "entries": {
      "memex-openclaw": {
        "enabled": true,
        "config": {
          // Path to MeMex Zero RAG wiki
          "wikiPath": "~/workspace/MeMex-Zero-RAG/wiki/",

          // Max wiki entries to inject per assembly (default: 5)
          "maxInjectEntries": 5,

          // Max chars per injected entry (default: 2000)
          "maxEntryChars": 2000,

          // Search mode: "keyword" | "semantic" | "hybrid" (default: "keyword")
          "searchMode": "keyword",

          // Whether to respect knowledge decay dates (default: true)
          "respectDecayDates": true,

          // Days before decay penalty kicks in (default: 90)
          "decayThresholdDays": 90,

          // Wiki sections to prioritize (default: ["concepts/", "agentforge/"])
          "priorityPaths": ["concepts/", "agentforge/"],

          // Enable conflict detection on bootstrap (default: true)
          "enableConflictDetection": true,

          // Verbose logging (default: false)
          "verbose": false
        }
      }
    }
  }
}
```

### Slot Assignment

The plugin registers as a ContextEngine provider. Set the slot in your config:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "memex-openclaw"
    }
  }
}
```

If you want to use MeMex alongside another ContextEngine plugin, disable MeMex's `injectOnAssemble` and run it purely as a conflict detector:

```json
{
  "config": {
    "injectOnAssemble": false,
    "enableConflictDetection": true
  }
}
```

## How It Works

### Architecture

```
User Message
    │
    ▼
ContextEngine.assemble ──► WikiIndex.search(query)
    │                           │
    │                    ┌──────┴──────┐
    │                    ▼             ▼
    │               BM25 Search    Priority Boost
    │                    │             │
    │                    └──────┬──────┘
    │                           ▼
    │                    Top-K Results
    │                           │
    ▼                           ▼
System Prompt Supplement ──► Main Agent Reply
```

### Hook Lifecycle

| Hook | What MeMex Does |
|---|---|
| `bootstrap` | Loads config, builds wiki index, runs conflict detection |
| `ingest` | Scans messages for new knowledge indicators (passive) |
| `assemble` | Searches wiki, injects relevant entries as system prompt supplement |
| `compact` | Adjusts session knowledge window based on decay awareness |
| `afterTurn` | Logs injection statistics per session |
| `prepareSubagent` | Provides lightweight wiki context for subagent tasks |
| `onSubagentEnded` | (Reserved for future use) |

### Search Algorithm

The plugin uses **BM25 keyword search** with:

- **Title boost**: Matches in entry titles score 2× higher
- **Priority paths**: Entries under `concepts/` and `agentforge/` receive a +100 score boost
- **Decay penalty**: Expired entries score at 30%; entries within 30 days of decay score at 50%–100%
- **Document frequency**: Rare terms score higher (standard IDF)

## Bundled Skill

The plugin installs a `memex-search` skill that agents can use for explicit wiki queries. Agents naturally learn to use it through the injected context.

## Verification

Check plugin status:

```bash
openclaw plugins list
openclaw plugins inspect memex-openclaw
```

The agent's `/context list` will show injected wiki entries as:

```
MeMex Zero RAG Wiki Context: OK | injected 5 entries (~850 chars)
```

## Development

```bash
git clone https://github.com/JPeetz/memex-openclaw-plugin
cd memex-openclaw-plugin
pnpm install
pnpm build
pnpm test
```

For local testing with OpenClaw:

```bash
openclaw plugins install --link /path/to/memex-openclaw-plugin
```

## Relation to Hermes Agent

This plugin uses the same core MeMex Zero RAG engine as the Hermes Agent plugin at `@memex/hermes-memory-provider` but adapted for OpenClaw's TypeScript/ContextEngine architecture. Knowledge indexed in one platform is immediately available in the other.

## License

Apache 2.0