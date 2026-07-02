import type {
  ExtractedDocument,
  MatchCandidate,
  ParsedItem,
  ProviderQuery,
  ProviderSearchResult,
  RawDocumentRef,
  ResultGroup,
  ScoredResult,
  SearchRequest,
  SearchResponse,
  SourceId
} from './types.js';

export interface ProcurementProvider {
  readonly source: SourceId;
  isEnabled(): boolean;
  search(query: ProviderQuery): Promise<ProviderSearchResult>;
}

export interface DocumentReader {
  extract(ref: RawDocumentRef): Promise<ExtractedDocument>;
}

export interface TextNormalizer {
  normalize(text: string): string;
}

export interface StopWordsProcessor {
  filter(tokens: string[]): string[];
}

export interface ItemTokenizer {
  tokenize(text: string): ParsedItem;
}

export interface CandidateMatcher {
  match(parsedQuery: ParsedItem, documents: ExtractedDocument[]): MatchCandidate[];
}

export interface SimilarityScorer {
  score(parsedQuery: ParsedItem, candidates: MatchCandidate[]): ScoredResult[];
}

export interface Clusterer {
  cluster(results: ScoredResult[]): ResultGroup[];
}

export interface Ranker {
  rank(groups: ResultGroup[]): ResultGroup[];
}

export interface SearchUseCase {
  search(request: SearchRequest): Promise<SearchResponse>;
}
