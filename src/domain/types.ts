export type SourceId = 'PNCP' | 'COMPRAS_GOV' | 'SANTA_CATARINA' | 'PARANA' | 'RIO_GRANDE_DO_SUL' | 'MOCK';

export type ProcurementDocType =
  | 'EDITAL'
  | 'ATA_REGISTRO_PRECOS'
  | 'CONTRATO_ADMINISTRATIVO'
  | 'HOMOLOGACAO'
  | 'AVISO_LICITACAO'
  | 'RESULTADO_JULGAMENTO'
  | 'CONTRATACAO_DIRETA'
  | 'OUTRO';

export type MatchStatus = 'matched' | 'partial' | 'missing' | 'conflict' | 'notApplicable';

export type ExplanationCriterion =
  | 'product'
  | 'technicalSpecs'
  | 'brand'
  | 'model'
  | 'color'
  | 'unit'
  | 'officialSource'
  | 'recency'
  | 'completeness'
  | 'negativeRule';

export type SearchRequest = {
  query: string;
  sources?: SourceId[];
  docTypes?: ProcurementDocType[];
  uf?: string;
  municipio?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type ProviderQuery = {
  originalQuery: string;
  normalizedTerms: string[];
  uf?: string;
  municipio?: string;
  docTypes?: ProcurementDocType[];
  dateFrom?: string;
  dateTo?: string;
  pageSize?: number;
};

export type RawDocumentRef = {
  id: string;
  source: SourceId;
  officialUrl: string;
  documentUrl?: string;
  documentType?: ProcurementDocType;
  organization?: string;
  municipio?: string;
  uf?: string;
  processNumber?: string;
  editalNumber?: string;
  modalidade?: string;
  publicationDate?: string;
  rawMetadata?: unknown;
  inlineText?: string;
};

export type ExtractedTable = { page?: number; rows: string[][]; confidence: number };
export type DocumentSection = { page?: number; title?: string; text: string; charStart?: number; charEnd?: number };
export type ExtractedDocument = { ref: RawDocumentRef; text: string; tables: ExtractedTable[]; sections: DocumentSection[]; extractionConfidence: number; warnings: string[] };

export type ParsedItem = {
  productMain?: string;
  category?: string;
  brand?: string;
  model?: string;
  color?: string;
  unit?: string;
  technicalSpecs: Record<string, string | number>;
  normalizedText: string;
  tokens: string[];
  confidence: number;
};

export type MatchCandidate = {
  document: ExtractedDocument;
  item: ParsedItem;
  excerpt: string;
  lexicalScore: number;
  sourceSpan?: { page?: number; section?: string; charStart?: number; charEnd?: number };
};

export type Explanation = { criterion: ExplanationCriterion; status: MatchStatus; contribution: number; message: string; evidence?: string };

export type ScoredResult = {
  id: string;
  tipoDocumento?: ProcurementDocType;
  orgao?: string;
  municipio?: string;
  estado?: string;
  numeroProcesso?: string;
  numeroEdital?: string;
  modalidade?: string;
  data?: string;
  descricaoEncontrada: string;
  similaridade: number;
  rankScore?: number;
  linkOficial: string;
  fonte: SourceId;
  trechoDocumento: string;
  parsedItem: ParsedItem;
  explanations: Explanation[];
};

export type ResultGroup = { id: string; label: string; representativeItem: ParsedItem; groupSimilarity: number; resultCount: number; results: ScoredResult[] };
export type SearchWarning = { source?: SourceId | 'SYSTEM'; message: string };

export type SearchRawDocument = {
  id: string;
  fonte: SourceId;
  tipoDocumento?: ProcurementDocType;
  orgao?: string;
  municipio?: string;
  estado?: string;
  numeroProcesso?: string;
  numeroEdital?: string;
  numeroControlePNCP?: string;
  modalidade?: string;
  data?: string;
  descricao?: string;
  linkOficial: string;
  linkDocumento?: string;
};

export type SearchResponse = { query: string; parsedQuery: ParsedItem; groups: ResultGroup[]; totalResults: number; warnings: SearchWarning[]; rawDocuments?: SearchRawDocument[] };
export type ProviderSearchResult = { documents: RawDocumentRef[]; warnings: SearchWarning[] };
