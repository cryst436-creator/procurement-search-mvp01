import type { ProcurementProvider } from '../domain/contracts.js';
import type { ProviderQuery, ProviderSearchResult } from '../domain/types.js';

export class SantaCatarinaProvider implements ProcurementProvider {
  readonly source = 'SANTA_CATARINA' as const;

  constructor(private readonly enabled = process.env.ENABLE_SANTA_CATARINA_PROVIDER === 'true') {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async search(_query: ProviderQuery): Promise<ProviderSearchResult> {
    if (!this.enabled) return { documents: [], warnings: [] };

    return {
      documents: [],
      warnings: [
        {
          source: this.source,
          message: 'SantaCatarinaProvider is isolated but not implemented because the MVP needs a confirmed stable official API or approved portal endpoint.'
        }
      ]
    };
  }
}
