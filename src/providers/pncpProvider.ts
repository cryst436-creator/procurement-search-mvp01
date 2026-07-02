import type { ProcurementProvider } from '../domain/contracts.js';
import type { ProviderQuery, ProviderSearchResult, RawDocumentRef, SearchWarning } from '../domain/types.js';

type DateRange = {
  dateFrom: string;
  dateTo: string;
  adjusted: boolean;
};

type PncpAttempt = {
  label: string;
  url: string;
  modalidade: string;
};

type PncpItem = {
  numeroItem?: number;
  descricao?: string;
  unidadeMedida?: string;
  quantidade?: number;
  valorUnitarioEstimado?: number;
  raw?: unknown;
};

const DEFAULT_MODALIDADES = [
  '6' // Pregão - Eletrônico. MVP 01 keeps the default narrow to avoid PNCP rate limits.
];

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

    const warnings: SearchWarning[] = [];
    const dateRange = buildPncpDateRange(query.dateFrom, query.dateTo);
    const requestedLimit = query.pageSize ?? 10;
    const pageSize = resolvePncpPageSize(requestedLimit);
    const attempts = this.buildAttempts(query, dateRange, pageSize);
    const documents: RawDocumentRef[] = [];
    const seen = new Set<string>();

    if (dateRange.adjusted) {
      warnings.push({
        source: this.source,
        message: `PNCPProvider adjusted the requested date range to ${dateRange.dateFrom}-${dateRange.dateTo} to avoid invalid/future dates.`
      });
    }

    if (pageSize !== requestedLimit) {
      warnings.push({
        source: this.source,
        message: `PNCPProvider adjusted tamanhoPagina from ${requestedLimit} to ${pageSize}. PNCP requires tamanhoPagina >= 10.`
      });
    }

    for (const attempt of attempts) {
      try {
        const response = await fetchWithTimeout(attempt.url, Number(process.env.PNCP_TIMEOUT_MS ?? 20000));

        if (response.status === 204) continue;

        if (response.status === 429) {
          const body = await readSmallBody(response);
          warnings.push({
            source: this.source,
            message: `PNCPProvider attempt '${attempt.label}' hit PNCP rate limit HTTP 429${body ? `: ${body}` : ''}. Wait a few minutes before retrying. URL: ${attempt.url}`
          });
          break;
        }

        if (!response.ok) {
          const body = await readSmallBody(response);
          warnings.push({
            source: this.source,
            message: `PNCPProvider attempt '${attempt.label}' returned HTTP ${response.status}${body ? `: ${body}` : ''}. URL: ${attempt.url}`
          });
          continue;
        }

        const payload = await response.json() as any;
        const rows = extractRows(payload);

        for (const row of rows) {
          const ref = mapPncpRow(row, this.baseUrl);
          const key = ref.id || ref.officialUrl;
          if (seen.has(key)) continue;
          seen.add(key);
          documents.push(ref);
        }

        // Do not fan out into more modalidades if we already got records. This avoids useless PNCP traffic.
        if (documents.length > 0) break;
      } catch (error) {
        warnings.push({
          source: this.source,
          message: `PNCPProvider attempt '${attempt.label}' unavailable: ${error instanceof Error ? error.message : 'unknown error'}. URL: ${attempt.url}`
        });
      }
    }

    const limitedDocuments = documents.slice(0, Math.min(requestedLimit, documents.length || requestedLimit));

    if (limitedDocuments.length > 0) {
      await this.enrichWithItems(limitedDocuments, warnings);
      warnings.push({
        source: this.source,
        message: `PNCPProvider collected ${limitedDocuments.length} publication record(s) from ${dateRange.dateFrom} to ${dateRange.dateTo}. Local similarity filtering will decide final matches.`
      });
      return { documents: limitedDocuments, warnings };
    }

    if (!warnings.length) {
      warnings.push({
        source: this.source,
        message: `PNCPProvider found no publication records from ${dateRange.dateFrom} to ${dateRange.dateTo}. Try a wider or older date range.`
      });
    }

    return { documents: [], warnings };
  }

  private buildAttempts(query: ProviderQuery, dateRange: DateRange, pageSize: number): PncpAttempt[] {
    const modalidades = resolveModalidades();
    const attempts: PncpAttempt[] = [];

    for (const modalidade of modalidades) {
      attempts.push(this.buildAttempt(`modalidade-${modalidade}`, dateRange, pageSize, modalidade, query.uf));
    }

    return attempts;
  }

  private buildAttempt(label: string, dateRange: DateRange, pageSize: number, modalidade: string, uf?: string): PncpAttempt {
    const params = new URLSearchParams();

    params.set('dataInicial', dateRange.dateFrom);
    params.set('dataFinal', dateRange.dateTo);
    params.set('codigoModalidadeContratacao', modalidade);
    params.set('pagina', '1');
    params.set('tamanhoPagina', String(pageSize));

    if (uf) params.set('uf', uf.toUpperCase());

    return {
      label,
      modalidade,
      url: `${this.baseUrl}/v1/contratacoes/publicacao?${params.toString()}`
    };
  }

  private async enrichWithItems(documents: RawDocumentRef[], warnings: SearchWarning[]): Promise<void> {
    const maxItemRequests = Math.max(0, Number(process.env.PNCP_ITEMS_MAX_REQUESTS ?? 2));
    if (maxItemRequests === 0) {
      warnings.push({ source: this.source, message: 'PNCP item enrichment disabled by PNCP_ITEMS_MAX_REQUESTS=0.' });
      return;
    }

    let requests = 0;
    for (const document of documents) {
      if (requests >= maxItemRequests) break;
      const numeroControle = extractNumeroControle(document);
      if (!numeroControle) continue;

      requests += 1;
      const result = await fetchPncpItems(this.baseUrl, numeroControle);
      warnings.push(...result.warnings.map((message) => ({ source: this.source, message })));

      if (!result.items.length) continue;

      const itemText = buildItemsText(result.items);
      document.inlineText = [document.inlineText, itemText].filter(Boolean).join('. ');
      document.rawMetadata = {
        publication: document.rawMetadata,
        itemEnrichment: {
          numeroControlePNCP: numeroControle,
          itemCount: result.items.length,
          items: result.items.slice(0, 30)
        }
      };
    }
  }
}

function resolveModalidades(): string[] {
  const explicitList = process.env.PNCP_MODALIDADES
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

  const preferred = process.env.PNCP_MODALIDADE?.trim();
  return unique([preferred, ...explicitList, ...DEFAULT_MODALIDADES].filter((value): value is string => Boolean(value)));
}

function resolvePncpPageSize(requestedLimit: number): number {
  const configuredMax = Math.max(Number(process.env.PNCP_PAGE_SIZE ?? 10), 10);
  const requested = Math.max(requestedLimit, 10);
  return Math.min(requested, configuredMax, 50);
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

async function readSmallBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.content)) return payload.content;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function buildPncpDateRange(dateFrom?: string, dateTo?: string): DateRange {
  const today = startOfDay(new Date());
  const requestedTo = parsePncpDate(dateTo) ?? today;
  const requestedFrom = parsePncpDate(dateFrom) ?? addDays(requestedTo, -30);

  let finalTo = requestedTo > today ? today : requestedTo;
  let finalFrom = requestedFrom;

  if (finalFrom > finalTo) {
    finalFrom = addDays(finalTo, -30);
  }

  const adjusted = toPncpDate(finalFrom) !== normalizePncpDate(dateFrom) || toPncpDate(finalTo) !== normalizePncpDate(dateTo);

  return {
    dateFrom: toPncpDate(finalFrom),
    dateTo: toPncpDate(finalTo),
    adjusted
  };
}

function parsePncpDate(value?: string): Date | undefined {
  const normalized = normalizePncpDate(value);
  if (!normalized) return undefined;

  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));

  if (!year || !month || !day) return undefined;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizePncpDate(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : undefined;
}

function toPncpDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function mapPncpRow(row: any, baseUrl: string): RawDocumentRef {
  const inlineText = buildInlineText(row);
  const numeroControle = String(row.numeroControlePNCP ?? '').trim();

  return {
    id: `pncp-${numeroControle || row.numeroCompra || row.sequencialCompra || cryptoRandomFallback()}`,
    source: 'PNCP',
    officialUrl: buildOfficialUrl(row, baseUrl),
    documentUrl: row.linkDocumento ?? row.urlDocumento,
    documentType: mapPncpDocType(row.tipoInstrumentoConvocatorioNome ?? row.tipoDocumentoNome ?? row.modalidadeNome),
    organization: row.orgaoEntidade?.razaoSocial ?? row.orgaoEntidade?.razaosocial ?? row.orgaoNome,
    municipio: row.unidadeOrgao?.municipioNome ?? row.municipioNome,
    uf: row.unidadeOrgao?.ufSigla ?? row.uf,
    processNumber: row.processo ?? row.numeroProcesso,
    editalNumber: row.numeroCompra,
    modalidade: row.modalidadeNome,
    publicationDate: row.dataPublicacaoPncp ?? row.dataPublicacao,
    rawMetadata: row,
    inlineText
  };
}

function buildInlineText(row: any): string {
  return [
    row.objetoCompra,
    row.informacaoComplementar,
    row.tipoInstrumentoConvocatorioNome,
    row.modalidadeNome,
    row.modoDisputaNome,
    row.situacaoCompraNome,
    row.orgaoEntidade?.razaoSocial ?? row.orgaoEntidade?.razaosocial,
    row.unidadeOrgao?.nomeUnidade,
    row.unidadeOrgao?.municipioNome,
    row.unidadeOrgao?.ufSigla,
    row.numeroCompra ? `Número da compra: ${row.numeroCompra}` : undefined,
    row.processo ? `Processo: ${row.processo}` : undefined,
    row.numeroControlePNCP ? `Número de controle PNCP: ${row.numeroControlePNCP}` : undefined
  ]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join('. ');
}

function buildItemsText(items: PncpItem[]): string {
  return items
    .slice(0, 40)
    .map((item) => [
      item.numeroItem ? `Item ${item.numeroItem}` : 'Item',
      item.descricao,
      item.unidadeMedida ? `Unidade ${item.unidadeMedida}` : undefined,
      typeof item.quantidade === 'number' ? `Quantidade ${item.quantidade}` : undefined,
      typeof item.valorUnitarioEstimado === 'number' ? `Valor unitário estimado ${item.valorUnitarioEstimado}` : undefined
    ].filter(Boolean).join(' - '))
    .join('. ');
}

function buildOfficialUrl(row: any, baseUrl: string): string {
  const numeroControle = String(row.numeroControlePNCP ?? '').trim();
  const match = numeroControle.match(/^(\d{14})-1-(\d{1,6})\/(\d{4})$/);

  if (match) {
    const [, cnpj, sequencial, ano] = match;
    return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(sequencial)}`;
  }

  return row.linkSistemaOrigem ?? row.linkProcessoEletronico ?? row.url ?? baseUrl;
}

function mapPncpDocType(value?: string): RawDocumentRef['documentType'] {
  const normalized = (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized.includes('edital')) return 'EDITAL';
  if (normalized.includes('ata')) return 'ATA_REGISTRO_PRECOS';
  if (normalized.includes('contrato')) return 'CONTRATO_ADMINISTRATIVO';
  if (normalized.includes('homolog')) return 'HOMOLOGACAO';
  if (normalized.includes('aviso')) return 'AVISO_LICITACAO';
  if (normalized.includes('dispensa') || normalized.includes('inexig')) return 'CONTRATACAO_DIRETA';
  return 'OUTRO';
}

function extractNumeroControle(document: RawDocumentRef): string | undefined {
  const raw = document.rawMetadata as any;
  const fromRaw = typeof raw?.numeroControlePNCP === 'string' ? raw.numeroControlePNCP : undefined;
  if (fromRaw) return fromRaw;
  const match = document.id.match(/pncp-(\d{14}-1-\d{1,6}\/\d{4})/);
  return match?.[1];
}

async function fetchPncpItems(baseUrl: string, numeroControlePNCP: string): Promise<{ items: PncpItem[]; warnings: string[] }> {
  const parsed = parseNumeroControle(numeroControlePNCP);
  const warnings: string[] = [];
  if (!parsed) return { items: [], warnings: [`Could not parse numeroControlePNCP for item enrichment: ${numeroControlePNCP}.`] };

  const urls = [
    `${baseUrl}/v1/orgaos/${parsed.cnpj}/compras/${parsed.ano}/${parsed.sequencial}/itens`,
    `${baseUrl}/v1/orgaos/${parsed.cnpj}/compras/${parsed.ano}/${parsed.sequencialCompra}/itens`
  ];

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, Number(process.env.PNCP_TIMEOUT_MS ?? 20000));
      if (response.status === 204 || response.status === 404) continue;
      if (response.status === 429) {
        warnings.push(`PNCP item enrichment hit HTTP 429. Wait before retrying. URL: ${url}`);
        break;
      }
      if (!response.ok) {
        const body = await readSmallBody(response);
        warnings.push(`PNCP item enrichment returned HTTP ${response.status}${body ? `: ${body}` : ''}. URL: ${url}`);
        continue;
      }

      const payload = await response.json() as any;
      const rows = extractRows(payload);
      const items = rows.map(mapPncpItem).filter((item) => item.descricao);
      if (items.length) return { items, warnings };
    } catch (error) {
      warnings.push(`PNCP item enrichment unavailable: ${error instanceof Error ? error.message : 'unknown error'}. URL: ${url}`);
    }
  }

  if (!warnings.length) warnings.push(`PNCP item enrichment found no items for ${numeroControlePNCP}.`);
  return { items: [], warnings };
}

function parseNumeroControle(value: string): { cnpj: string; ano: string; sequencial: string; sequencialCompra: string } | undefined {
  const match = value.trim().match(/^(\d{14})-1-(\d{1,6})\/(\d{4})$/);
  if (!match) return undefined;
  const [, cnpj, sequencialCompra, ano] = match;
  return { cnpj, ano, sequencial: String(Number(sequencialCompra)), sequencialCompra };
}

function mapPncpItem(row: any): PncpItem {
  return {
    numeroItem: Number(row.numeroItem ?? row.item ?? 0) || undefined,
    descricao: row.descricao ?? row.descricaoItem ?? row.descricaoDetalhada ?? row.nome ?? row.objetoCompra,
    unidadeMedida: row.unidadeMedida ?? row.unidadeFornecimento,
    quantidade: Number(row.quantidade ?? row.qtd) || undefined,
    valorUnitarioEstimado: Number(row.valorUnitarioEstimado ?? row.valorUnitario ?? row.valor) || undefined,
    raw: row
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function cryptoRandomFallback(): string {
  return Math.random().toString(36).slice(2, 10);
}
