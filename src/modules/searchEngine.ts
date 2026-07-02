import type {
  CandidateMatcher,
  Clusterer,
  DocumentReader,
  ItemTokenizer,
  ProcurementProvider,
  Ranker,
  SearchUseCase,
  SimilarityScorer,
  TextNormalizer
} from '../domain/contracts.js';
import type { ExtractedDocument, ProviderQuery, RawDocumentRef, SearchRequest, SearchResponse, SearchWarning } from '../domain/types.js';
import { Normalizer } from './normalizer.js';
import { Tokenizer } from './tokenizer.js';
import { Matcher } from './matcher.js';
import { SimilarityEngine } from './similarityEngine.js';
import { ClusterEngine } from './clusterEngine.js';
import { RankingEngine } from './rankingEngine.js';
import { PDFReader } from '../pdf/pdfReader.js';
import { MockProvider } from '../providers/mockProvider.js';
import { PNCPProvider } from '../providers/pncpProvider.js';
import { ComprasGovProvider } from '../providers/comprasGovProvider.js';
import { SantaCatarinaProvider } from '../providers/santaCatarinaProvider.js';

export class SearchEngine implements SearchUseCase {
  constructor(
    private readonly providers: ProcurementProvider[],
    private readonly documentReader: DocumentReader,
    private readonly normalizer: TextNormalizer,
    private readonly tokenizer: ItemTokenizer,
    private readonly matcher: CandidateMatcher,
    private readonly similarityScorer: SimilarityScorer,
    private readonly clusterer: Clusterer,
    private readonly ranker: Ranker
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const warnings: SearchWarning[] = [];
    const query = request.query?.trim();
    if (!query) throw new Error('Search query is required.');

    const parsedQuery = this.tokenizer.tokenize(query);
    const providerQuery: ProviderQuery = {
      originalQuery: query,
      normalizedTerms: this.buildSearchTerms(query, parsedQuery.tokens),
      uf: request.uf,
      municipio: request.municipio,
      docTypes: request.docTypes,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      pageSize: request.limit ?? 20
    };

    const enabledProviders = this.providers.filter((provider) => {
      if (!provider.isEnabled()) return false;
      if (request.sources?.length && !request.sources.includes(provider.source)) return false;
      return true;
    });

    if (!enabledProviders.length) {
      warnings.push({ source: 'SYSTEM', message: 'No provider enabled. Falling back to mock provider is recommended for local testing.' });
    }

    const providerResults = await Promise.allSettled(enabledProviders.map((provider) => provider.search(providerQuery)));
    const rawRefs = [];
    for (const result of providerResults) {
      if (result.status === 'fulfilled') {
        rawRefs.push(...result.value.documents);
        warnings.push(...result.value.warnings);
      } else {
        warnings.push({ source: 'SYSTEM', message: `Provider failed: ${result.reason instanceof Error ? result.reason.message : 'unknown error'}` });
      }
    }

    const dedupedRefs = dedupeByOfficialUrl(rawRefs).slice(0, request.limit ?? 50);
    const extractedDocuments = await this.extractDocuments(dedupedRefs, warnings);
    const candidates = this.matcher.match(parsedQuery, extractedDocuments);
    const scored = this.similarityScorer
      .score(parsedQuery, candidates)
      .filter((result) => result.similaridade >= 25);
    const groups = this.clusterer.cluster(scored);
    const rankedGroups = this.ranker.rank(groups);

    return {
      query,
      parsedQuery,
      groups: rankedGroups,
      totalResults: rankedGroups.reduce((sum, group) => sum + group.resultCount, 0),
      warnings
    };
  }

  private buildSearchTerms(query: string, tokens: string[]): string[] {
    const normalized = this.normalizer.normalize(query);
    return [...new Set([normalized, ...tokens].filter(Boolean))];
  }

  private async extractDocuments(refs: RawDocumentRef[], warnings: SearchWarning[]): Promise<ExtractedDocument[]> {
    const extracted: ExtractedDocument[] = [];
    const results = await Promise.allSettled(refs.map((ref) => this.documentReader.extract(ref)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        extracted.push(result.value);
        warnings.push(...result.value.warnings.map((message) => ({ source: result.value.ref.source, message })));
      } else {
        warnings.push({ source: 'SYSTEM', message: `PDF extraction failed: ${result.reason instanceof Error ? result.reason.message : 'unknown error'}` });
      }
    }
    return extracted;
  }
}

function dedupeByOfficialUrl<T extends { officialUrl: string; id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = item.officialUrl || item.id;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

export function createDefaultSearchEngine(): SearchEngine {
  const normalizer = new Normalizer();
  const tokenizer = new Tokenizer(normalizer);
  return new SearchEngine(
    [
      new MockProvider(process.env.ENABLE_MOCK_PROVIDER !== 'false'),
      new PNCPProvider(),
      new ComprasGovProvider(),
      new SantaCatarinaProvider()
    ],
    new PDFReader(),
    normalizer,
    tokenizer,
    new Matcher(tokenizer),
    new SimilarityEngine(),
    new ClusterEngine(),
    new RankingEngine()
  );
}
