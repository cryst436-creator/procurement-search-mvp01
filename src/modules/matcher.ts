import type { CandidateMatcher, ItemTokenizer } from '../domain/contracts.js';
import type { ExtractedDocument, MatchCandidate, ParsedItem } from '../domain/types.js';
import { tokenizer as defaultTokenizer } from './tokenizer.js';

export class Matcher implements CandidateMatcher {
  constructor(private readonly tokenizer: ItemTokenizer = defaultTokenizer) {}

  match(parsedQuery: ParsedItem, documents: ExtractedDocument[]): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];

    for (const document of documents) {
      if (!document.text || document.extractionConfidence <= 0) continue;

      const excerpts = buildExcerpts(document.text);
      for (const excerpt of excerpts) {
        const parsedCandidate = this.tokenizer.tokenize(excerpt);
        const lexicalScore = lexicalSimilarity(parsedQuery, parsedCandidate, excerpt);
        const strongProductHit = Boolean(parsedQuery.productMain && parsedCandidate.productMain === parsedQuery.productMain);
        const strongBrandHit = Boolean(parsedQuery.brand && parsedCandidate.brand === parsedQuery.brand);
        const strongTextHit = containsImportantTerm(parsedQuery, excerpt);

        if (lexicalScore >= 0.12 || strongProductHit || strongBrandHit || strongTextHit) {
          candidates.push({
            document,
            item: parsedCandidate,
            excerpt,
            lexicalScore,
            sourceSpan: { page: 1 }
          });
        }
      }
    }

    return dedupeCandidates(candidates)
      .sort((a, b) => b.lexicalScore - a.lexicalScore)
      .slice(0, 120);
  }
}

function buildExcerpts(text: string): string[] {
  const chunks = text
    .split(/\n|\.\s+|;\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 250);

  if (chunks.length <= 1) return [text];
  return chunks.map((chunk, index) => {
    const before = chunks[index - 1] ?? '';
    const after = chunks[index + 1] ?? '';
    return [before, chunk, after].filter(Boolean).join('. ');
  });
}

function lexicalSimilarity(query: ParsedItem, candidate: ParsedItem, excerpt: string): number {
  const queryTokens = query.tokens.length ? query.tokens : query.normalizedText.split(/\s+/).filter(Boolean);
  const candidateTokens = candidate.tokens.length ? candidate.tokens : candidate.normalizedText.split(/\s+/).filter(Boolean);

  if (!queryTokens.length || !candidateTokens.length) return 0;

  const candidateSet = new Set(candidateTokens);
  const lowerExcerpt = excerpt.toLowerCase();
  let exact = 0;

  for (const token of queryTokens) {
    if (candidateSet.has(token)) exact += 1;
    else if (lowerExcerpt.includes(token)) exact += 0.8;
    else if ([...candidateSet].some((candidateToken) => trigramSimilarity(token, candidateToken) >= 0.55)) exact += 0.65;
  }

  if (query.productMain && candidate.productMain === query.productMain) exact += 0.5;
  if (query.brand && candidate.brand === query.brand) exact += 0.25;
  if (query.color && candidate.color === query.color) exact += 0.15;

  return Math.min(1, exact / Math.max(queryTokens.length, 1));
}

function containsImportantTerm(query: ParsedItem, excerpt: string): boolean {
  const lowerExcerpt = excerpt.toLowerCase();
  if (query.productMain && lowerExcerpt.includes(query.productMain)) return true;
  if (query.brand && lowerExcerpt.includes(query.brand)) return true;
  if (query.model && lowerExcerpt.includes(query.model)) return true;

  const meaningfulTerms = query.normalizedText.split(/\s+/).filter((term) => term.length >= 5);
  return meaningfulTerms.some((term) => lowerExcerpt.includes(term));
}

function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  const union = new Set([...gramsA, ...gramsB]);
  const intersection = [...gramsA].filter((gram) => gramsB.has(gram)).length;
  return union.size ? intersection / union.size : 0;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const map = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.document.ref.id}:${candidate.excerpt.slice(0, 120)}`;
    const previous = map.get(key);
    if (!previous || candidate.lexicalScore > previous.lexicalScore) map.set(key, candidate);
  }
  return [...map.values()];
}

export const matcher = new Matcher();
