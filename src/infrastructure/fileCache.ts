import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class FileCache {
  constructor(
    private readonly directory = process.env.RUNTIME_CACHE_DIR ?? './runtime-cache',
    private readonly defaultTtlMs = Number(process.env.CACHE_TTL_MS ?? 1000 * 60 * 30)
  ) {}

  async get<T>(namespace: string, key: string): Promise<T | undefined> {
    try {
      const raw = await readFile(this.pathFor(namespace, key), 'utf-8');
      const entry = JSON.parse(raw) as { expiresAt: string; value: T };
      if (new Date(entry.expiresAt).getTime() < Date.now()) return undefined;
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(namespace: string, key: string, value: T, ttlMs = this.defaultTtlMs): Promise<void> {
    const dir = path.join(this.directory, safeSegment(namespace));
    await mkdir(dir, { recursive: true });
    const entry = {
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      value
    };
    await writeFile(this.pathFor(namespace, key), JSON.stringify(entry), 'utf-8');
  }

  private pathFor(namespace: string, key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return path.join(this.directory, safeSegment(namespace), `${hash}.json`);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}
