import type { ProcurementProvider } from '../domain/contracts.js';
import type { ProviderQuery, ProviderSearchResult, RawDocumentRef } from '../domain/types.js';
import { mockDocuments } from '../data/mockDocuments.js';

export class MockProvider implements ProcurementProvider {
  readonly source = 'MOCK' as const;

  constructor(private readonly enabled = true) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async search(query: ProviderQuery): Promise<ProviderSearchResult> {
    const terms = query.normalizedTerms;
    const documents: RawDocumentRef[] = mockDocuments.filter((doc) => {
      if (query.uf && doc.uf !== query.uf) return false;
      if (query.municipio && doc.municipio?.toLowerCase() !== query.municipio.toLowerCase()) return false;
      if (query.docTypes?.length && doc.documentType && !query.docTypes.includes(doc.documentType)) return false;
      const haystack = `${doc.inlineText ?? ''} ${doc.organization ?? ''} ${doc.municipio ?? ''}`.toLowerCase();
      return terms.some((term) => haystack.includes(term)) || terms.length === 0;
    });

    return { documents, warnings: [] };
  }
}
