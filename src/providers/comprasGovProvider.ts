import type { ProcurementProvider } from '../domain/contracts.js';
import type { ProviderQuery, ProviderSearchResult, RawDocumentRef } from '../domain/types.js';

export class ComprasGovProvider implements ProcurementProvider {
  readonly source = 'COMPRAS_GOV' as const;

  constructor(
    private readonly baseUrl = process.env.COMPRASGOV_BASE_URL ?? 'https://dadosabertos.compras.gov.br/modulo-licitacoes/1_consultarLicitacao',
    private readonly enabled = process.env.ENABLE_COMPRASGOV_PROVIDER === 'true'
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async search(query: ProviderQuery): Promise<ProviderSearchResult> {
    if (!this.enabled) return { documents: [], warnings: [] };

    try {
      const params = new URLSearchParams();
      if (query.dateFrom) params.set('data_publicacao_min', query.dateFrom);
      if (query.dateTo) params.set('data_publicacao_max', query.dateTo);
      if (query.uf) params.set('uf', query.uf);

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        headers: { accept: 'application/json' }
      });

      if (!response.ok) {
        return {
          documents: [],
          warnings: [{ source: this.source, message: `ComprasGovProvider returned HTTP ${response.status}. Check endpoint/query configuration.` }]
        };
      }

      const payload = await response.json() as any;
      const rows: any[] = Array.isArray(payload?.resultado) ? payload.resultado : Array.isArray(payload) ? payload : [];

      const documents: RawDocumentRef[] = rows.map((row, index) => ({
        id: `comprasgov-${row.codigoUASG ?? 'uasg'}-${row.numeroCompra ?? index}`,
        source: this.source,
        officialUrl: row.link ?? row.uri ?? this.baseUrl,
        documentUrl: row.linkEdital ?? row.urlDocumento,
        documentType: 'EDITAL',
        organization: row.nomeUasg ?? row.orgao,
        municipio: row.municipio,
        uf: row.uf,
        processNumber: row.numeroProcesso,
        editalNumber: row.numeroCompra,
        modalidade: row.modalidadeCompra,
        publicationDate: row.dataPublicacao,
        rawMetadata: row
      }));

      return { documents, warnings: [] };
    } catch (error) {
      return {
        documents: [],
        warnings: [{ source: this.source, message: `ComprasGovProvider unavailable: ${error instanceof Error ? error.message : 'unknown error'}` }]
      };
    }
  }
}
