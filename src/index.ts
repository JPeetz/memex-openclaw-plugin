/**
 * @memex/openclaw-memex — MeMex Zero RAG ContextEngine Plugin
 *
 * Registers a ContextEngine that injects MeMex Zero RAG wiki knowledge.
 * Uses the OpenClaw Plugin SDK to register via `api.registerContextEngine()`.
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { WikiIndex, detectConflicts, } from './wiki-index.js';
import { type MemexConfig, resolveConfig } from './config.js';

interface ContextEngineInstance {
  info: {
    id: string;
    name: string;
    version: string;
    ownsCompaction: boolean;
  };
  ingest(params: Record<string, unknown>): Promise<{ ingested: boolean }>;
  assemble(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  compact(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function createEngine(config: MemexConfig): ContextEngineInstance {
  const wikiIndex = new WikiIndex({
    maxFileSizeBytes: config.maxFileSizeBytes,
    includePatterns: config.includePatterns,
    excludePatterns: config.excludePatterns,
    priorityPaths: config.priorityPaths,
    verbose: config.verbose,
    titleBoostFactor: config.titleBoostFactor,
  });

  // Build index eagerly
  wikiIndex.buildIndex(config.wikiPath).then(() => {
    if (config.verbose) {
      const stats = wikiIndex.getStats();
      console.log(`[memex-openclaw] Index built: ${stats.totalEntries} entries, ${stats.expiredCount} expired`);
    }
    if (config.enableConflictDetection) {
      const conflicts = detectConflicts(wikiIndex.getAllEntries());
      if (conflicts.length > 0) {
        for (const c of conflicts) {
          console.warn(`[memex-openclaw] Conflict [${c.severity}]: ${c.title} — ${c.detail}`);
        }
      }
    }
  }).catch((err: Error) => {
    if (config.verbose) console.warn(`[memex-openclaw] Index build failed: ${err.message}`);
  });

  return {
    info: {
      id: 'memex-openclaw',
      name: 'MeMex Zero RAG',
      version: '0.1.0',
      ownsCompaction: false,
    },

    async ingest(_params: Record<string, unknown>): Promise<{ ingested: boolean }> {
      return { ingested: false };
    },

    async assemble(params: Record<string, unknown>): Promise<Record<string, unknown>> {
      const messages = (params.messages ?? []) as Record<string, unknown>[];
      if (!config.injectOnAssemble || messages.length === 0) {
        return { messages, estimatedTokens: 0 };
      }

      // Build a query from the last user message
      const sessionKey = params.sessionKey as string ?? '';
      const queryParts: string[] = [];
      const keyParts = sessionKey.split(':');
      if (keyParts.length >= 3) queryParts.push(keyParts[1], keyParts[2]);
      queryParts.push('knowledge', 'memory', 'wiki');
      const query = queryParts.join(' ');

      const results = wikiIndex.search(query, config.maxInjectEntries);
      if (results.length === 0) {
        return { messages, estimatedTokens: 0 };
      }

      // Build wiki injection message
      const lines: string[] = [
        '<!-- MeMex Zero RAG Wiki Context -->',
        '',
      ];
      let totalChars = 0;
      for (const result of results) {
        const entryText = `[${result.entry.title}] ${result.entry.excerpt.slice(0, 200)}`;
        if (totalChars + entryText.length > config.maxEntryChars * config.maxInjectEntries) break;
        lines.push(`- ${entryText} (wiki/${result.entry.path})`);
        totalChars += entryText.length;
      }

      const wikiMessage: Record<string, unknown> = {
        role: 'system',
        content: lines.join('\n'),
      };

      if (config.verbose) {
        console.log(`[memex-openclaw] Injected ${results.length} wiki entries`);
      }

      return { messages: [wikiMessage, ...messages], estimatedTokens: 0 };
    },

    async compact(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
      let compacted = false;
      if (config.respectDecayDates) {
        compacted = wikiIndex.getStats().expiredCount > 0;
      }
      return { ok: true, compacted };
    },
  };
}

const pluginEntry: Record<string, unknown> = definePluginEntry({
  id: 'memex-openclaw',
  name: 'MeMex Zero RAG',
  description: 'Durable, anti-hallucination wiki memory for OpenClaw agents',
  register(api: Record<string, unknown>) {
    const apiAny = api as Record<string, Function>;
    const pluginConfigRaw = (api as Record<string, unknown>).pluginConfig ?? {};
    const userConfig = (pluginConfigRaw as Record<string, unknown>).config as Record<string, unknown> ?? {};
    const config = resolveConfig(userConfig);

    apiAny.registerContextEngine?.('memex-openclaw', () => createEngine(config));
  },
});
export default pluginEntry;

export { WikiIndex, detectConflicts } from './wiki-index.js';
export { type MemexConfig, resolveConfig } from './config.js';