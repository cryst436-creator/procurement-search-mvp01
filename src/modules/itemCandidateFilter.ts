import type { MatchCandidate, SearchWarning } from '../domain/types.js';

const BROAD_NON_ITEM_TERMS = [
  'solucao tecnologica',
  'inteligencia fiscal',
  'servico especializado',
  'servico continuo',
  'servico de engenharia',
  'consultoria',
  'terraplanagem',
  'pavimentacao',
  'obra',
  'engenharia',
  'capacitacao',
  'treinamento',
  'locacao',
  'plataforma',
  'software',
  'nuvem',
  'machine learning',
  'auditores fiscais',
  'administracao tributaria'
];

export function filterItemCandidates(candidates: MatchCandidate[], warnings: SearchWarning[]): MatchCandidate[] {
  let rejected = 0;
  let blocked = 0;

  const filtered = candidates.filter((candidate) => {
    const raw = candidate.document.ref.rawMetadata as any;
    const fromItems = Boolean(raw?.itemEnrichment);
    const isMock = candidate.document.ref.source === 'MOCK';
    const text = normalize(candidate.excerpt);

    if (!isMock && hasBroadNonItemTerm(text)) {
      blocked += 1;
      return false;
    }

    const hasItemWords = text.includes('item ') || text.includes('lote ') || text.includes('quantidade') || text.includes('unidade') || text.includes('marca') || text.includes('modelo') || text.includes('descricao');
    const hasParsedItem = Boolean(candidate.item.productMain || candidate.item.brand || candidate.item.unit || Object.keys(candidate.item.technicalSpecs).length > 0);

    if (isMock || fromItems || (hasItemWords && hasParsedItem)) return true;

    rejected += 1;
    return false;
  });

  if (rejected > 0) warnings.push({ source: 'SYSTEM', message: `${rejected} candidate(s) ignored because they did not look like licitation items.` });
  if (blocked > 0) warnings.push({ source: 'SYSTEM', message: `${blocked} candidate(s) blocked because they looked like broad service, work, software or institutional descriptions.` });
  return filtered;
}

function hasBroadNonItemTerm(text: string): boolean {
  return BROAD_NON_ITEM_TERMS.some((term) => text.includes(term));
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
