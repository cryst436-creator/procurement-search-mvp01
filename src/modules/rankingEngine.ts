import type { Ranker } from '../domain/contracts.js';
import type { ResultGroup, ScoredResult } from '../domain/types.js';

export class RankingEngine implements Ranker {
  rank(groups: ResultGroup[]): ResultGroup[] {
    const rankedGroups = groups.map((group) => {
      const rankedResults = group.results
        .map((result) => ({ ...result, rankScore: computeRankScore(result) }))
        .sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));

      return {
        ...group,
        results: rankedResults,
        groupSimilarity: average(rankedResults.map((result) => result.similaridade))
      };
    });

    return rankedGroups.sort((a, b) => computeGroupScore(b) - computeGroupScore(a));
  }
}

function computeRankScore(result: ScoredResult): number {
  const similarity = result.similaridade;
  const recency = recencyScore(result.data);
  const completeness = completenessScore(result);
  const provider = result.fonte === 'MOCK' ? 90 : 100;
  return round(similarity * 0.8 + recency * 0.1 + completeness * 0.07 + provider * 0.03);
}

function computeGroupScore(group: ResultGroup): number {
  const top = group.results[0]?.rankScore ?? group.results[0]?.similaridade ?? 0;
  const avg = group.groupSimilarity;
  const countBoost = Math.log(group.resultCount + 1) * 10;
  return round(top * 0.7 + avg * 0.2 + countBoost * 0.1);
}

function recencyScore(date?: string): number {
  if (!date) return 50;
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return 50;
  const days = (Date.now() - parsed) / 86_400_000;
  if (days <= 30) return 100;
  if (days <= 90) return 80;
  if (days <= 180) return 60;
  if (days <= 365) return 40;
  return 20;
}

function completenessScore(result: ScoredResult): number {
  const fields = [
    result.tipoDocumento,
    result.orgao,
    result.municipio,
    result.estado,
    result.numeroProcesso,
    result.numeroEdital,
    result.modalidade,
    result.data,
    result.descricaoEncontrada,
    result.linkOficial,
    result.fonte,
    result.trechoDocumento
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export const rankingEngine = new RankingEngine();
