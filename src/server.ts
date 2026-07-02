import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { createDefaultSearchEngine } from './modules/searchEngine.js';

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  sources: z.array(z.enum(['PNCP', 'COMPRAS_GOV', 'SANTA_CATARINA', 'MOCK'])).optional(),
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

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const searchEngine = createDefaultSearchEngine();

app.get('/health', async () => ({ ok: true, service: 'procurement-search-mvp01' }));

app.post('/search', async (request: any, reply: any) => {
  const parsed = SearchRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Invalid search request', details: parsed.error.flatten() });
  }

  try {
    const response = await searchEngine.search(parsed.data);
    return reply.send(response);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown search error' });
  }
});

const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: '0.0.0.0' });
