import type { ProcurementProvider } from '../domain/contracts.js';
import type { ProviderQuery, ProviderSearchResult } from '../domain/types.js';

export class RioGrandeDoSulProvider implements ProcurementProvider {
  readonly source = 'RIO_GRANDE_DO_SUL' as const;

  constructor(private readonly enabled = process.env.ENABLE_RIO_GRANDE_DO_SUL_PROVIDER === 'true') {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async search(_query: ProviderQuery): Promise<ProviderSearchResult> {
    if (!this.enabled) return { documents: [], warnings: [] };
    return {
      documents: [],
      warnings: [{ source: this.source, message: 'RioGrandeDoSulProvider stub is present, but no official endpoint has been configured yet.' }]
    };
  }
}
