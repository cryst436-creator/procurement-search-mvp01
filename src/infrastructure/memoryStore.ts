export type SearchHistoryEntry = {
  id: string;
  createdAt: string;
  query: string;
  totalResults: number;
  warningsCount: number;
};

export class MemoryStore {
  private readonly history: SearchHistoryEntry[] = [];

  add(entry: SearchHistoryEntry): void {
    this.history.unshift(entry);
    if (this.history.length > 100) this.history.pop();
  }

  list(): SearchHistoryEntry[] {
    return [...this.history];
  }
}
