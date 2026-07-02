import type { ProcurementProvider } from '../domain/contracts.js';
import type { ProviderQuery, ProviderSearchResult, RawDocumentRef } from '../domain/types.js';

export class PNCPProvider implements ProcurementProvider {
  readonly source = 'PNCP' as const;

  constructor(
    private readonly baseUrl = process.env.PNCP_BASE_URL ?? 'https://pncp.gov.br/api/consulta',
    private readonly enabled = process.env.ENABLE_PNCP_PROVIDER === 'true'
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async search(query: ProviderQuery): Promise<ProviderSearchResult> {
    if (!this.enabled) return { documents: [], warnings: [] };

    try {
      const params = new URLSearchParams();

      if (query.dateFrom) params.set('dataInicial', query.dateFrom);
      if (query.dateTo) params.set('dataFinal', query.dateTo);
      if (query.uf) params.set('uf', query.uf);

      // MVP 01: usa Pregão Eletrônico como modalidade inicial controlada.
      // No PNCP, exemplos públicos de consulta por publicação usam codigoModalidadeContratacao.
      params.set('codigoModalidadeContratacao', process.env.PNCP_MODALIDADE ?? '8');

      params.set('pagina', '1');
      params.set('tamanhoPagina', String(Math.min(query.pageSize ?? 5, 5)));

      const url = `${this.baseUrl}/v1/contratacoes/publicacao?${params.toString()}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        return {
          documents: [],
          warnings: [{ source: this.source, message: `PNCPProvider returned HTTP ${response.status}. URL: ${url}` }]
        };
      }

      const payload = await response.json() as any;
      const rows: any[] = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];

      const documents: RawDocumentRef[] = rows.map((row, index) => ({
        id: `pncp-${row.numeroControlePNCP ?? row.numeroCompra ?? index}`,
        source: this.source,
        officialUrl: row.linkSistemaOrigem ?? row.linkProcessoEletronico ?? row.url ?? this.baseUrl,
        documentUrl: row.linkDocumento ?? row.urlDocumento,
        documentType: mapPncpDocType(row.tipoDocumentoNome ?? row.modalidadeNome),
        organization: row.orgaoEntidade?.razaoSocial ?? row.orgaoNome,
        municipio: row.unidadeOrgao?.municipioNome ?? row.municipioNome,
        uf: row.unidadeOrgao?.ufSigla ?? row.uf,
        processNumber: row.numeroProcesso,
        editalNumber: row.numeroCompra,
        modalidade: row.modalidadeNome,
        publicationDate: row.dataPublicacaoPncp ?? row.dataPublicacao,
        rawMetadata: row
      }));

      return { documents, warnings: [] };
    } catch (error) {
      return {
        documents: [],
        warnings: [{ source: this.source, message: `PNCPProvider unavailable: ${error instanceof Error ? error.message : 'unknown error'}` }]
      };
    }
  }
}

function mapPncpDocType(value?: string): RawDocumentRef['documentType'] {
  const normalized = (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized.includes('edital')) return 'EDITAL';
  if (normalized.includes('ata')) return 'ATA_REGISTRO_PRECOS';
  if (normalized.includes('contrato')) return 'CONTRATO_ADMINISTRATIVO';
  if (normalized.includes('homolog')) return 'HOMOLOGACAO';
  if (normalized.includes('dispensa') || normalized.includes('inexig')) return 'CONTRATACAO_DIRETA';
  return 'OUTRO';
}
