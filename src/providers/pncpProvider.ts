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

    const warnings: ProviderSearchResult['warnings'] = [];

    const primaryParams = this.buildParams(query);
    const attempts: Array<{ label: string; params: URLSearchParams }> = [
      { label: 'primary', params: primaryParams }
    ];

    // Some PNCP queries are more stable without UF when the endpoint is under load or the filter is too restrictive.
    // Keep this fallback isolated inside the provider so the rest of the search engine stays unchanged.
    if (query.uf) {
      const withoutUf = new URLSearchParams(primaryParams);
      withoutUf.delete('uf');
      attempts.push({ label: 'without-uf', params: withoutUf });
    }

    for (const attempt of attempts) {
      const url = `${this.baseUrl}/v1/contratacoes/publicacao?${attempt.params.toString()}`;

      try {
        const response = await fetchWithTimeout(url, Number(process.env.PNCP_TIMEOUT_MS ?? 20000));

        if (response.status === 204) {
          return {
            documents: [],
            warnings: [{ source: this.source, message: `PNCPProvider returned HTTP 204. No records for this filter. URL: ${url}` }]
          };
        }

        if (!response.ok) {
          warnings.push({
            source: this.source,
            message: `PNCPProvider attempt '${attempt.label}' returned HTTP ${response.status}. URL: ${url}`
          });

          if ([500, 502, 503, 504].includes(response.status)) continue;
          return { documents: [], warnings };
        }

        const payload = await response.json() as any;
        const rows: any[] = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.content)
            ? payload.content
            : Array.isArray(payload)
              ? payload
              : [];

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

        return { documents, warnings };
      } catch (error) {
        warnings.push({
          source: this.source,
          message: `PNCPProvider attempt '${attempt.label}' unavailable: ${error instanceof Error ? error.message : 'unknown error'}. URL: ${url}`
        });
      }
    }

    return { documents: [], warnings };
  }

  private buildParams(query: ProviderQuery): URLSearchParams {
    const params = new URLSearchParams();

    const dateFrom = normalizePncpDate(query.dateFrom);
    const dateTo = normalizePncpDate(query.dateTo);

    if (dateFrom) params.set('dataInicial', dateFrom);
    if (dateTo) params.set('dataFinal', dateTo);
    if (query.uf) params.set('uf', query.uf.toUpperCase());

    // MVP 01: usa Pregão Eletrônico como modalidade inicial controlada.
    // Pode ser alterado no Render pela variável PNCP_MODALIDADE.
    params.set('codigoModalidadeContratacao', process.env.PNCP_MODALIDADE ?? '8');

    params.set('pagina', '1');
    params.set('tamanhoPagina', String(Math.min(query.pageSize ?? 5, 5)));

    return params;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePncpDate(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : value;
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
