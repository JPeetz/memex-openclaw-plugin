/**
 * MeMex Zero RAG — Wiki Indexer
 *
 * Indexes and searches MeMex Zero RAG wiki markdown files.
 * Supports BM25 keyword search, frontmatter metadata extraction,
 * knowledge decay awareness, and conflict detection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';

// --- Types ---

export interface WikiEntry {
  /** Relative path from wiki root */
  path: string;
  /** File title (from frontmatter or filename) */
  title: string;
  /** YAML frontmatter metadata */
  metadata: Record<string, unknown>;
  /** Full text content (without frontmatter) */
  content: string;
  /** First 200 chars as excerpt */
  excerpt: string;
  /** Last modified timestamp */
  modifiedAt: Date;
  /** Knowledge decay date (from frontmatter.decay or null) */
  decayDate: Date | null;
  /** File size in bytes */
  sizeBytes: number;
  /** Tags from frontmatter */
  tags: string[];
  /** Whether this entry is expired (past decay date) */
  isExpired: boolean;
}

export interface SearchResult {
  entry: WikiEntry;
  score: number;
  matchedTerms: string[];
}

interface IndexOptions {
  maxFileSizeBytes: number;
  includePatterns: string[];
  excludePatterns: string[];
  priorityPaths: string[];
  verbose: boolean;
  titleBoostFactor: number;
}

// --- Simple BM25 Tokenizer ---

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && t.length < 100);
}

// --- Frontmatter Parser (lightweight, no deps) ---

function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const data: Record<string, unknown> = {};
  let content = raw;

  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4);
    if (end !== -1) {
      const fmLines = raw.slice(4, end).split('\n');
      for (const line of fmLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim();
          let value: unknown = line.slice(colonIdx + 1).trim();
          // Parse simple YAML values
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(String(value))) value = parseInt(String(value), 10);
          else if (/^\d+\.\d+$/.test(String(value))) value = parseFloat(String(value));
          data[key] = value;
        }
      }
      content = raw.slice(end + 5);
    }
  }

  return { data, content };
}

// --- Document Frequency Cache ---

interface DfCache {
  totalDocs: number;
  df: Map<string, number>; // term -> document frequency
}

// --- Wiki Indexer ---

export class WikiIndex {
  private entries: WikiEntry[] = [];
  private dfCache: DfCache | null = null;
  private avgDocLength = 0;
  private options: IndexOptions;

  constructor(options: IndexOptions) {
    this.options = options;
  }

  /** Build or rebuild the index from the wiki directory */
  async buildIndex(wikiPath: string): Promise<void> {
    if (!fs.existsSync(wikiPath)) {
      if (this.options.verbose) {
        console.warn(`[memex-openclaw] Wiki path not found: ${wikiPath}`);
      }
      this.entries = [];
      return;
    }

    this.entries = [];
    const files = await this.discoverFiles(wikiPath);

    for (const file of files) {
      try {
        const fullPath = path.join(wikiPath, file);
        const stat = fs.statSync(fullPath);

        if (stat.size > this.options.maxFileSizeBytes) continue;

        const raw = fs.readFileSync(fullPath, 'utf-8');
        const { data, content } = parseFrontmatter(raw);

        const title = String(data.title || path.basename(file, '.md'));
        const tags: string[] = [];
        if (Array.isArray(data.tags)) {
          data.tags.forEach(t => tags.push(String(t)));
        }

        let decayDate: Date | null = null;
        if (data.decay) {
          const d = new Date(String(data.decay));
          if (!isNaN(d.getTime())) decayDate = d;
        }

        this.entries.push({
          path: file,
          title,
          metadata: data,
          content,
          excerpt: content.slice(0, 200).replace(/\n/g, ' '),
          modifiedAt: stat.mtime,
          decayDate,
          sizeBytes: stat.size,
          tags,
          isExpired: decayDate ? decayDate < new Date() : false,
        });
      } catch (err) {
        if (this.options.verbose) {
          console.warn(`[memex-openclaw] Failed to index ${file}:`, err);
        }
      }
    }

    if (this.options.verbose) {
      console.log(`[memex-openclaw] Indexed ${this.entries.length} wiki entries from ${wikiPath}`);
    }

    // Rebuild DF cache
    this.buildDfCache();
  }

  /** Search the wiki index */
  search(query: string, topK: number = 5): SearchResult[] {
    if (this.entries.length === 0) return [];

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const results: SearchResult[] = [];

    for (const entry of this.entries) {
      const score = this.scoreEntry(entry, queryTerms);
      if (score > 0) {
        results.push({
          entry,
          score,
          matchedTerms: queryTerms.filter(t =>
            tokenize(entry.title + ' ' + entry.content).includes(t)
          ),
        });
      }
    }

    // Sort by score descending, with priority boost
    results.sort((a, b) => {
      const aPriority = this.hasPriorityPath(a.entry) ? 100 : 0;
      const bPriority = this.hasPriorityPath(b.entry) ? 100 : 0;
      return (b.score + bPriority) - (a.score + aPriority);
    });

    return results.slice(0, topK);
  }

  /** Search with title boosts */
  private scoreEntry(entry: WikiEntry, queryTerms: string[]): number {
    const k1 = 1.2;
    const b = 0.75;
    const titleTokens = tokenize(entry.title);
    const bodyTokens = tokenize(entry.content);

    let score = 0;
    const docLen = titleTokens.length + bodyTokens.length;
    const avgDocLen = this.avgDocLength || 1;

    for (const term of queryTerms) {
      const df = this.dfCache?.df.get(term) ?? 1;
      const idf = Math.log(
        (this.entries.length - df + 0.5) / (df + 0.5) + 1
      );

      // Count in title (with boost)
      const titleFreq = titleTokens.filter(t => t === term).length;
      const titleScore = titleFreq * (this.options.titleBoostFactor ?? 1.0);

      // Count in body
      const bodyFreq = bodyTokens.filter(t => t === term).length;

      const tf = titleScore + bodyFreq;
      if (tf > 0) {
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))));
      }
    }

    // Apply decay penalty
    if (entry.isExpired) {
      score *= 0.3;
    } else if (entry.decayDate) {
      const daysUntilDecay = (entry.decayDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilDecay < 30) {
        score *= 0.5 + (daysUntilDecay / 60);
      }
    }

    return score;
  }

  /** Check if entry path matches a priority prefix */
  private hasPriorityPath(entry: WikiEntry): boolean {
    return this.options.priorityPaths.some(p => entry.path.startsWith(p));
  }

  /** Build BM25 document frequency cache */
  private buildDfCache(): void {
    const df = new Map<string, number>();
    const totalDocs = this.entries.length;
    let totalLength = 0;

    for (const entry of this.entries) {
      const tokens = new Set(tokenize(entry.title + ' ' + entry.content));
      for (const token of tokens) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
      totalLength += entry.title.length + entry.content.length;
    }

    this.dfCache = { totalDocs, df };
    this.avgDocLength = totalDocs > 0 ? totalLength / totalDocs : 1;
  }

  /** Discover wiki markdown files */
  private async discoverFiles(wikiPath: string): Promise<string[]> {
    const files: string[] = [];

    function walk(dir: string, relativeDir: string = '') {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), relPath);
        } else if (entry.name.endsWith('.md')) {
          files.push(relPath);
        }
      }
    }

    walk(wikiPath);
    return files;
  }

  /** Get all entries (for conflict detection) */
  getAllEntries(): WikiEntry[] {
    return [...this.entries];
  }

  /** Get stats about the index */
  getStats(): { totalEntries: number; totalSizeBytes: number; expiredCount: number } {
    return {
      totalEntries: this.entries.length,
      totalSizeBytes: this.entries.reduce((s, e) => s + e.sizeBytes, 0),
      expiredCount: this.entries.filter(e => e.isExpired).length,
    };
  }
}

// --- Conflict Detection ---

export interface ConflictReport {
  type: 'stale' | 'contradiction' | 'missing_decay';
  path: string;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export function detectConflicts(entries: WikiEntry[]): ConflictReport[] {
  const reports: ConflictReport[] = [];

  for (const entry of entries) {
    // Check for expired entries without decay date
    if (entry.modifiedAt < new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) && !entry.decayDate) {
      reports.push({
        type: 'missing_decay',
        path: entry.path,
        title: entry.title,
        detail: `Entry not modified in 180+ days and has no decay date set. Consider adding a decay: date.`,
        severity: 'medium',
      });
    }

    // Check for expired high-severity knowledge
    if (entry.isExpired && entry.tags.includes('critical')) {
      reports.push({
        type: 'stale',
        path: entry.path,
        title: entry.title,
        detail: `Critical knowledge entry has expired (decay: ${entry.decayDate?.toISOString()}). Needs review.`,
        severity: 'high',
      });
    }
  }

  // Check for title conflicts
  const titleMap = new Map<string, string[]>();
  for (const entry of entries) {
    const existing = titleMap.get(entry.title) ?? [];
    existing.push(entry.path);
    titleMap.set(entry.title, existing);
  }

  for (const [title, paths] of titleMap) {
    if (paths.length > 1) {
      reports.push({
        type: 'contradiction',
        path: paths.join(', '),
        title,
        detail: `Multiple entries share the same title "${title}" at: ${paths.join(', ')}. May indicate conflicting knowledge.`,
        severity: 'low',
      });
    }
  }

  return reports;
}