import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { ProviderQuery, SearchRequest } from './domain/types.js';
import { createDefaultSearchEngine, toSearchRawDocument } from './modules/searchEngine.js';
import { FileCache } from './infrastructure/fileCache.js';
import { MemoryStore } from './infrastructure/memoryStore.js';
import { PNCPProvider } from './providers/pncpProvider.js';

const CACHE_NAMESPACE = 'search-v2-item-filter';
const SourceSchema = z.enum(['PNCP', 'COMPRAS_GOV', 'SANTA_CATARINA', 'PARANA', 'RIO_GRANDE_DO_SUL', 'MOCK']);

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  sources: z.array(SourceSchema).optional(),
  docTypes: z.array(z.enum([
    'EDITAL',
    'ATA_REGISTRO_PRECOS',
    'CONTRATO_ADMINISTRATIVO',
    'HOMOLOGACAO',
    'AVISO_LICITACAO',
    'RESULTADO_JULGAMENTO',
    'CONTRATACAO_DIRETA',
    'OUTRO'
  ])).optional(),
  uf: z.string().length(2).optional(),
  municipio: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const SearchTestQuerySchema = z.object({
  query: z.string().min(1).default('caneta'),
  source: SourceSchema.optional(),
  uf: z.string().length(2).optional(),
  municipio: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const DebugPncpQuerySchema = z.object({
  query: z.string().min(1).default('caneta'),
  uf: z.string().length(2).optional(),
  municipio: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  raw: z.coerce.boolean().optional()
});

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const searchEngine = createDefaultSearchEngine();
const pncpProvider = new PNCPProvider();
const cache = new FileCache();
const memoryStore = new MemoryStore();

app.get('/health', async () => ({ ok: true, service: 'procurement-search-mvp01' }));

app.get('/status', async () => ({
  ok: true,
  service: 'procurement-search-mvp01',
  stage: 'MVP 01 demo operacional',
  modules: {
    pncp: process.env.ENABLE_PNCP_PROVIDER === 'true' ? 'enabled' : 'disabled',
    mock: process.env.ENABLE_MOCK_PROVIDER === 'false' ? 'disabled' : 'enabled',
    cache: `runtime file cache namespace ${CACHE_NAMESPACE}`,
    database: 'runtime memory history',
    pdfReader: 'inline text, metadata fallback and lightweight document fetch',
    frontend: 'basic browser page',
    pncpItems: 'experimental enrichment inside PNCPProvider',
    debug: ['/debug/pncp', '/debug/pncp/raw', '/debug/cache', '/debug/provider-status'],
    preparedSources: ['PNCP', 'COMPRAS_GOV', 'SANTA_CATARINA', 'PARANA', 'RIO_GRANDE_DO_SUL']
  }
}));

app.get('/', async (_request: any, reply: any) => reply.type('text/html').send(simpleHtml()));
app.get('/app', async (_request: any, reply: any) => reply.type('text/html').send(simpleHtml()));
app.get('/history', async () => ({ ok: true, history: memoryStore.list() }));

app.get('/debug/cache', async () => ({
  ok: true,
  cache: {
    type: 'runtime-file-cache',
    namespace: CACHE_NAMESPACE,
    ttlMs: Number(process.env.CACHE_TTL_MS ?? 1000 * 60 * 30),
    directory: process.env.RUNTIME_CACHE_DIR ?? './runtime-cache',
    note: 'Cache is temporary and may reset on deploy or restart.'
  }
}));

app.get('/debug/provider-status', async () => ({
  ok: true,
  providers: {
    PNCP: { enabled: process.env.ENABLE_PNCP_PROVIDER === 'true', modalidade: process.env.PNCP_MODALIDADE ?? '6', modalidades: process.env.PNCP_MODALIDADES ?? null, itemsMaxRequests: Number(process.env.PNCP_ITEMS_MAX_REQUESTS ?? 2) },
    MOCK: { enabled: process.env.ENABLE_MOCK_PROVIDER !== 'false' },
    COMPRAS_GOV: { enabled: process.env.ENABLE_COMPRAS_GOV_PROVIDER === 'true' },
    SANTA_CATARINA: { enabled: process.env.ENABLE_SANTA_CATARINA_PROVIDER === 'true' },
    PARANA: { enabled: process.env.ENABLE_PARANA_PROVIDER === 'true' },
    RIO_GRANDE_DO_SUL: { enabled: process.env.ENABLE_RIO_GRANDE_DO_SUL_PROVIDER === 'true' }
  }
}));

app.get('/debug/pncp', async (request: any, reply: any) => debugPncp(request, reply, false));
app.get('/debug/pncp/raw', async (request: any, reply: any) => debugPncp(request, reply, true));

app.get('/search-test', async (request: any, reply: any) => {
  const parsed = SearchTestQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid search test query', details: parsed.error.flatten() });

  const { source, ...rest } = parsed.data;
  const searchRequest: SearchRequest = { ...rest, sources: source ? [source] : undefined };

  try {
    const response = await cachedSearch(searchRequest);
    return reply.send({ mode: 'browser-search-test', request: searchRequest, ...response });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown search test error' });
  }
});

app.post('/search', async (request: any, reply: any) => {
  const parsed = SearchRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid search request', details: parsed.error.flatten() });

  try {
    const response = await cachedSearch(parsed.data as SearchRequest);
    return reply.send(response);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown search error' });
  }
});

async function debugPncp(request: any, reply: any, forceRaw: boolean) {
  const parsed = DebugPncpQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid PNCP debug query', details: parsed.error.flatten() });

  const query = parsed.data.query.trim();
  const providerQuery: ProviderQuery = {
    originalQuery: query,
    normalizedTerms: [query.toLowerCase()],
    uf: parsed.data.uf,
    municipio: parsed.data.municipio,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    pageSize: parsed.data.limit
  };

  try {
    const result = await pncpProvider.search(providerQuery);
    const documents = result.documents.map((ref) => ({ ...toSearchRawDocument(ref), rawMetadata: forceRaw || parsed.data.raw ? ref.rawMetadata : undefined }));
    return reply.send({ mode: forceRaw ? 'pncp-raw-debug' : 'pncp-debug', request: providerQuery, totalRawDocuments: documents.length, documents, warnings: result.warnings });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown PNCP debug error' });
  }
}

async function cachedSearch(searchRequest: SearchRequest) {
  const key = JSON.stringify(searchRequest);
  const cached = await cache.get<any>(CACHE_NAMESPACE, key);
  if (cached) {
    cached.warnings = [...(cached.warnings ?? []), { source: 'SYSTEM', message: `Result served from runtime cache namespace ${CACHE_NAMESPACE}.` }];
    registerHistory(searchRequest.query, cached.totalResults ?? 0, cached.warnings.length);
    return cached;
  }

  const response = await searchEngine.search(searchRequest);
  await cache.set(CACHE_NAMESPACE, key, response);
  registerHistory(searchRequest.query, response.totalResults, response.warnings.length);
  return response;
}

function registerHistory(query: string, totalResults: number, warningsCount: number): void {
  memoryStore.add({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), query, totalResults, warningsCount });
}

function simpleHtml(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Busca Pública MVP 01</title><style>body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;color:#172033}header{background:#111827;color:white;padding:28px}main{max-width:960px;margin:0 auto;padding:22px}.card{background:white;border:1px solid #dbe3ef;border-radius:16px;padding:18px;margin-bottom:16px}input,select,button{padding:12px;border-radius:10px;border:1px solid #cbd5e1}button{background:#1d4ed8;color:white;font-weight:700}.row{display:flex;gap:10px;flex-wrap:wrap}.muted{color:#64748b}a{color:#1d4ed8}</style></head><body><header><h1>Busca Pública MVP 01</h1><p>Demo do motor de busca semântica para documentos públicos.</p></header><main><section class="card"><form action="/search-test" method="get"><div class="row"><input name="query" value="caneta" placeholder="Caneta Azul Bic Cristal"><select name="source"><option>PNCP</option><option>MOCK</option></select><input name="uf" value="SC" maxlength="2"><input name="limit" value="5"><button>Pesquisar</button></div></form><p class="muted">Use /debug/pncp para ver as publicações brutas do PNCP quando a busca não encontrar match.</p></section><section class="card"><h2>Links rápidos</h2><p><a href="/health">Health</a> · <a href="/status">Status</a> · <a href="/history">Histórico</a> · <a href="/debug/provider-status">Providers</a> · <a href="/debug/cache">Cache</a> · <a href="/debug/pncp?query=caneta&uf=SC&limit=5">Debug PNCP</a> · <a href="/search-test?query=Caneta%20Azul%20Bic%20Cristal&source=MOCK&uf=SC&limit=5">Teste MOCK</a> · <a href="/search-test?query=caneta&source=PNCP&uf=SC&limit=5">Teste PNCP</a></p></section></main></body></html>`;
}

const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: '0.0.0.0' });
