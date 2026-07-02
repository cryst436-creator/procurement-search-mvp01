import type { MatchCandidate, SearchWarning } from '../domain/types.js';

export function filterItemCandidates(candidates: MatchCandidate[], warnings: SearchWarning[]): MatchCandidate[] {
  let rejected = 0;
  const filtered = candidates.filter((candidate) => {
    const raw = candidate.document.ref.rawMetadata as any;
    const fromItems = Boolean(raw?.itemEnrichment);
    const isMock = candidate.document.ref.source === 'MOCK';
    const text = candidate.excerpt.toLowerCase();
    const hasItemWords = text.includes('item ') || text.includes('lote ') || text.includes('quantidade') || text.includes('unidade') || text.includes('marca') || text.includes('modelo') || text.includes('descricao');
    const hasParsedItem = Boolean(candidate.item.productMain || candidate.item.brand || candidate.item.unit || Object.keys(candidate.item.technicalSpecs).length > 0);
    if (isMock || fromItems || (hasItemWords && hasParsedItem)) return true;
    rejected += 1;
    return false;
  });

  if (rejected > 0) warnings.push({ source: 'SYSTEM', message: `${rejected} candidate(s) ignored because they did not look like licitation items.` });
  return filtered;
}
