/**
 * MeMex Zero RAG — OpenClaw ContextEngine Plugin
 * Configuration types and defaults
 */

export interface MemexConfig {
  /** Path to the MeMex Zero RAG wiki directory */
  wikiPath: string;

  /** Glob patterns for wiki files to index */
  includePatterns: string[];

  /** Glob patterns to exclude from indexing */
  excludePatterns: string[];

  /** Maximum wiki entries to inject per assembly */
  maxInjectEntries: number;

  /** Maximum chars per injected wiki entry */
  maxEntryChars: number;

  /** Whether to inject wiki context as system prompt supplement */
  injectOnAssemble: boolean;

  /** Search mode: 'keyword' | 'semantic' | 'hybrid' */
  searchMode: 'keyword' | 'semantic' | 'hybrid';

  /** Whether to respect knowledge decay dates */
  respectDecayDates: boolean;

  /** Decay threshold in days (entries older than this get lower priority) */
  decayThresholdDays: number;

  /** Whether to append a "wiki context" block to every assembly */
  alwaysInjectWikiContext: boolean;

  /** Whether to log verbose diagnostics */
  verbose: boolean;

  /** Specific wiki sections to prioritize (e.g. ["concepts/", "agentforge/"]) */
  priorityPaths: string[];

  /** Session patterns to exclude from wiki injection */
  ignoreSessionPatterns: string[];

  /** BM25 keyword boost factor for title matches */
  titleBoostFactor: number;

  /** Max file size in bytes for indexing */
  maxFileSizeBytes: number;

  /** Whether to enable conflict detection reporting */
  enableConflictDetection: boolean;
}

export const DEFAULT_CONFIG: MemexConfig = {
  wikiPath: '~/workspace/MeMex-Zero-RAG/wiki/',
  includePatterns: ['**/*.md'],
  excludePatterns: ['node_modules/**', '.git/**'],
  maxInjectEntries: 5,
  maxEntryChars: 2000,
  injectOnAssemble: true,
  searchMode: 'keyword',
  respectDecayDates: true,
  decayThresholdDays: 90,
  alwaysInjectWikiContext: false,
  verbose: false,
  priorityPaths: ['concepts/', 'agentforge/'],
  ignoreSessionPatterns: [
    'agent:*:cron:**',
    'agent:*:**:active-memory:**',
    'agent:*:heartbeat:**',
  ],
  titleBoostFactor: 2.0,
  maxFileSizeBytes: 1024 * 1024, // 1MB
  enableConflictDetection: true,
};

export type PartialMemexConfig = Partial<MemexConfig>;

export function resolveConfig(userConfig: PartialMemexConfig | undefined): MemexConfig {
  const merged = { ...DEFAULT_CONFIG, ...userConfig };

  // Resolve ~ to home directory
  if (merged.wikiPath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '/home/user';
    merged.wikiPath = merged.wikiPath.replace('~', home);
  }

  return merged;
}