# MeMex Search

Search the MeMex Zero RAG wiki for relevant knowledge. Use this when you need to recall documented decisions, architecture patterns, operational procedures, or any institutional knowledge stored in the wiki.

## When to use

- You need to recall something from past sessions or documented knowledge
- A user asks about a topic that might be documented in the wiki
- You're making a decision and want to check established precedents
- You need to verify facts against the institutional knowledge base

## How to use

Ask naturally — the plugin handles search automatically during context assembly. For explicit searches:

**"Search the wiki for [topic]"**
→ Triggers a full BM25 search across all wiki entries

**"What does MeMex know about [topic]?"**
→ Same search, higher priority

**"Check the wiki for decisions about [topic]"**
→ Filters to entries tagged with 'decision'

## Bundled content

The plugin includes a search context that indexes all markdown files in `~/workspace/MeMex-Zero-RAG/wiki/`. The index is rebuilt on plugin bootstrap and supports:

- **BM25 keyword search** — precision search across title and body
- **Frontmatter metadata** — title, tags, decay dates, categories
- **Knowledge decay awareness** — expired entries deprioritized automatically
- **Conflict detection** — duplicate titles flagged on bootstrap
- **Priority paths** — entries under `concepts/` and `agentforge/` boosted

## Configuration

See plugin README for full config options. Key settings:

- `searchMode`: 'keyword' (default), 'semantic', or 'hybrid'
- `maxInjectEntries`: entries injected per assembly (default 5)
- `alwaysInjectWikiContext`: always inject wiki block (default false)

## References

- MeMex Zero RAG: `~/workspace/MeMex-Zero-RAG/`
- Plugin config: `plugins.entries.memex-openclaw.config` in `openclaw.json`