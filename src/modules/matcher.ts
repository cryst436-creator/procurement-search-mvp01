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
        const lexicalScore = lexicalSimilarity(parsedQuery.tokens, parsedCandidate.tokens);
        const strongProductHit = parsedQuery.productMain && parsedCandidate.productMain === parsedQuery.productMain;
        const strongBrandHit = parsedQuery.brand && parsedCandidate.brand === parsedQuery.brand;

        if (lexicalScore >= 0.18 || strongProductHit || strongBrandHit) {
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
      .slice(0, 100);
  }
}

function buildExcerpts(text: string): string[] {
  const chunks = text
    .split(/\n|\.\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (chunks.length <= 1) return [text];
  return chunks.map((chunk, index) => {
    const before = chunks[index - 1] ?? '';
    const after = chunks[index + 1] ?? '';
    return [before, chunk, after].filter(Boolean).join('. ');
  });
}

function lexicalSimilarity(queryTokens: string[], candidateTokens: string[]): number {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  let exact = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token)) exact += 1;
    else if ([...candidateSet].some((candidate) => trigramSimilarity(token, candidate) >= 0.55)) exact += 0.65;
  }
  return exact / queryTokens.length;
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
