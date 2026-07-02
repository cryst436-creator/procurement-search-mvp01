import type { SimilarityScorer } from '../domain/contracts.js';
import type { Explanation, MatchCandidate, ParsedItem, ScoredResult } from '../domain/types.js';

const BASE_WEIGHTS = {
  product: 40,
  technicalSpecs: 20,
  brand: 15,
  model: 10,
  color: 5,
  unit: 5,
  officialSource: 5
} as const;

type Criterion = keyof typeof BASE_WEIGHTS;

type CriterionScore = {
  value: number;
  status: Explanation['status'];
  evidence?: string;
  message: string;
};

type Conflict = {
  scoreCap?: number;
  penalty?: number;
  explanation: Explanation;
};

export class SimilarityEngine implements SimilarityScorer {
  score(parsedQuery: ParsedItem, candidates: MatchCandidate[]): ScoredResult[] {
    return candidates.map((candidate) => this.scoreOne(parsedQuery, candidate));
  }

  private scoreOne(query: ParsedItem, candidate: MatchCandidate): ScoredResult {
    const activeWeights = getActiveWeights(query);
    const criterionScores: Record<Criterion, CriterionScore> = {
      product: scoreProduct(query, candidate.item),
      technicalSpecs: scoreTechnicalSpecs(query, candidate.item),
      brand: scoreExactField('brand', query.brand, candidate.item.brand, 'Marca'),
      model: scoreModel(query.model, candidate.item.model),
      color: scoreExactField('color', query.color, candidate.item.color, 'Cor'),
      unit: scoreExactField('unit', query.unit, candidate.item.unit, 'Unidade de medida'),
      officialSource: {
        value: candidate.document.ref.source === 'MOCK' ? 0.9 : 1,
        status: 'matched',
        evidence: candidate.document.ref.source,
        message: `Fonte oficial ou homologada para MVP: ${candidate.document.ref.source}.`
      }
    };

    const explanations: Explanation[] = [];
    let similarity = 0;

    for (const criterion of Object.keys(activeWeights) as Criterion[]) {
      const weight = activeWeights[criterion];
      const score = criterionScores[criterion];
      const contribution = round(score.value * weight);
      similarity += contribution;
      explanations.push({
        criterion: criterion === 'officialSource' ? 'officialSource' : criterion,
        status: score.status,
        contribution,
        evidence: score.evidence,
        message: score.message
      });
    }

    const conflicts = detectConflicts(query, candidate.item);
    for (const conflict of conflicts) {
      if (typeof conflict.scoreCap === 'number') similarity = Math.min(similarity, conflict.scoreCap);
      if (typeof conflict.penalty === 'number') similarity -= conflict.penalty;
      explanations.push(conflict.explanation);
    }

    similarity = clamp(round(similarity), 0, 100);

    return {
      id: `${candidate.document.ref.id}-${hash(candidate.excerpt)}`,
      tipoDocumento: candidate.document.ref.documentType,
      orgao: candidate.document.ref.organization,
      municipio: candidate.document.ref.municipio,
      estado: candidate.document.ref.uf,
      numeroProcesso: candidate.document.ref.processNumber,
      numeroEdital: candidate.document.ref.editalNumber,
      modalidade: candidate.document.ref.modalidade,
      data: candidate.document.ref.publicationDate,
      descricaoEncontrada: summarizeDescription(candidate.excerpt),
      similaridade: similarity,
      linkOficial: candidate.document.ref.officialUrl,
      fonte: candidate.document.ref.source,
      trechoDocumento: candidate.excerpt,
      parsedItem: candidate.item,
      explanations
    };
  }
}

function getActiveWeights(query: ParsedItem): Record<Criterion, number> {
  const active: Partial<Record<Criterion, number>> = {
    product: BASE_WEIGHTS.product,
    officialSource: BASE_WEIGHTS.officialSource
  };

  if (Object.keys(query.technicalSpecs).length > 0) active.technicalSpecs = BASE_WEIGHTS.technicalSpecs;
  if (query.brand) active.brand = BASE_WEIGHTS.brand;
  if (query.model) active.model = BASE_WEIGHTS.model;
  if (query.color) active.color = BASE_WEIGHTS.color;
  if (query.unit) active.unit = BASE_WEIGHTS.unit;

  const totalActive = Object.values(active).reduce((sum, value) => sum + (value ?? 0), 0);
  const scale = 100 / totalActive;
  return Object.fromEntries(Object.entries(active).map(([key, value]) => [key, (value ?? 0) * scale])) as Record<Criterion, number>;
}

function scoreProduct(query: ParsedItem, candidate: ParsedItem): CriterionScore {
  if (!query.productMain) return { value: 0.5, status: 'missing', message: 'Produto principal não identificado na consulta.' };
  if (candidate.productMain === query.productMain) {
    return { value: 1, status: 'matched', evidence: candidate.productMain, message: `Produto compatível: ${candidate.productMain}.` };
  }
  if (candidate.category && query.category && candidate.category === query.category) {
    return { value: 0.5, status: 'partial', evidence: candidate.productMain, message: `Mesma categoria, mas produto diferente: ${candidate.productMain ?? 'não identificado'}.` };
  }
  return { value: 0, status: 'conflict', evidence: candidate.productMain, message: `Produto incompatível: consulta pede ${query.productMain}, documento indica ${candidate.productMain ?? 'produto não identificado'}.` };
}

function scoreTechnicalSpecs(query: ParsedItem, candidate: ParsedItem): CriterionScore {
  const entries = Object.entries(query.technicalSpecs);
  if (!entries.length) return { value: 1, status: 'notApplicable', message: 'Consulta não especificou requisitos técnicos.' };

  let total = 0;
  const evidence: string[] = [];
  for (const [key, value] of entries) {
    const candidateValue = candidate.technicalSpecs[key];
    if (candidateValue === value) {
      total += 1;
      evidence.push(`${key}=${String(value)}`);
    } else if (candidate.tokens.includes(String(value))) {
      total += 0.75;
      evidence.push(`${key}≈${String(value)}`);
    }
  }

  const value = total / entries.length;
  if (value >= 0.85) return { value, status: 'matched', evidence: evidence.join(', '), message: 'Especificações técnicas compatíveis.' };
  if (value > 0) return { value, status: 'partial', evidence: evidence.join(', '), message: 'Especificações técnicas parcialmente compatíveis.' };
  return { value: 0, status: 'missing', message: 'Especificações técnicas da consulta não foram encontradas.' };
}

function scoreExactField(field: 'brand' | 'color' | 'unit', query?: string, candidate?: string, label?: string): CriterionScore {
  if (!query) return { value: 1, status: 'notApplicable', message: `${label ?? field} não especificada na consulta.` };
  if (!candidate) return { value: 0.3, status: 'missing', message: `${label ?? field} não encontrada no documento.` };
  if (query === candidate) return { value: 1, status: 'matched', evidence: candidate, message: `${label ?? field} compatível: ${candidate}.` };
  return { value: 0, status: 'conflict', evidence: candidate, message: `${label ?? field} incompatível: consulta pede ${query}, documento indica ${candidate}.` };
}

function scoreModel(query?: string, candidate?: string): CriterionScore {
  if (!query) return { value: 1, status: 'notApplicable', message: 'Modelo não especificado na consulta.' };
  if (!candidate) return { value: 0.3, status: 'missing', message: 'Modelo não encontrado no documento.' };
  if (query === candidate) return { value: 1, status: 'matched', evidence: candidate, message: `Modelo compatível: ${candidate}.` };
  if (candidate.includes(query) || query.includes(candidate)) return { value: 0.6, status: 'partial', evidence: candidate, message: `Modelo parcialmente compatível: ${candidate}.` };
  return { value: 0, status: 'conflict', evidence: candidate, message: `Modelo incompatível: consulta pede ${query}, documento indica ${candidate}.` };
}

function detectConflicts(query: ParsedItem, candidate: ParsedItem): Conflict[] {
  const conflicts: Conflict[] = [];

  if (query.productMain && candidate.productMain && query.productMain !== candidate.productMain) {
    if (query.category && candidate.category && query.category !== candidate.category) {
      conflicts.push({
        scoreCap: 35,
        explanation: {
          criterion: 'negativeRule',
          status: 'conflict',
          contribution: -65,
          message: `Regra negativa: categoria incompatível (${query.productMain} ≠ ${candidate.productMain}).`,
          evidence: candidate.productMain
        }
      });
    } else if (candidate.productMain === 'refil' || query.productMain === 'refil') {
      conflicts.push({
        scoreCap: 45,
        explanation: {
          criterion: 'negativeRule',
          status: 'conflict',
          contribution: -55,
          message: 'Regra negativa: produto principal não deve ser confundido com acessório/refil.',
          evidence: candidate.productMain
        }
      });
    } else {
      conflicts.push({
        scoreCap: 55,
        explanation: {
          criterion: 'negativeRule',
          status: 'conflict',
          contribution: -45,
          message: `Regra negativa: produto diferente dentro da mesma categoria (${query.productMain} ≠ ${candidate.productMain}).`,
          evidence: candidate.productMain
        }
      });
    }
  }

  if (query.color && candidate.color && query.color !== candidate.color) {
    conflicts.push({
      scoreCap: 55,
      explanation: {
        criterion: 'negativeRule',
        status: 'conflict',
        contribution: -45,
        message: `Regra negativa: cor incompatível (${query.color} ≠ ${candidate.color}).`,
        evidence: candidate.color
      }
    });
  }

  if (query.brand && candidate.brand && query.brand !== candidate.brand) {
    conflicts.push({
      scoreCap: 70,
      explanation: {
        criterion: 'negativeRule',
        status: 'conflict',
        contribution: -30,
        message: `Regra negativa: marca incompatível (${query.brand} ≠ ${candidate.brand}).`,
        evidence: candidate.brand
      }
    });
  }

  if (query.unit && candidate.unit && query.unit !== candidate.unit) {
    conflicts.push({
      scoreCap: 60,
      explanation: {
        criterion: 'negativeRule',
        status: 'conflict',
        contribution: -40,
        message: `Regra negativa: unidade incompatível (${query.unit} ≠ ${candidate.unit}).`,
        evidence: candidate.unit
      }
    });
  }

  return conflicts;
}

function summarizeDescription(text: string): string {
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function hash(value: string): string {
  let hashValue = 0;
  for (let i = 0; i < value.length; i += 1) hashValue = ((hashValue << 5) - hashValue + value.charCodeAt(i)) | 0;
  return Math.abs(hashValue).toString(36);
}

export const similarityEngine = new SimilarityEngine();
