import type { Clusterer } from '../domain/contracts.js';
import type { ParsedItem, ResultGroup, ScoredResult } from '../domain/types.js';

export class ClusterEngine implements Clusterer {
  cluster(results: ScoredResult[]): ResultGroup[] {
    const groups: ResultGroup[] = [];

    for (const result of results) {
      const compatibleGroup = groups.find((group) => canJoinGroup(group.representativeItem, result.parsedItem));
      if (compatibleGroup) {
        compatibleGroup.results.push(result);
        compatibleGroup.resultCount = compatibleGroup.results.length;
        compatibleGroup.groupSimilarity = average(compatibleGroup.results.map((item) => item.similaridade));
      } else {
        groups.push({
          id: `group-${groups.length + 1}`,
          label: buildGroupLabel(result.parsedItem),
          representativeItem: result.parsedItem,
          groupSimilarity: result.similaridade,
          resultCount: 1,
          results: [result]
        });
      }
    }

    return groups.map((group) => ({
      ...group,
      results: group.results.sort((a, b) => b.similaridade - a.similaridade),
      groupSimilarity: average(group.results.map((item) => item.similaridade))
    }));
  }
}

function canJoinGroup(a: ParsedItem, b: ParsedItem): boolean {
  if (a.category && b.category && a.category !== b.category) return false;
  if (a.productMain && b.productMain && a.productMain !== b.productMain) return false;
  if (a.color && b.color && a.color !== b.color) return false;
  if (a.unit && b.unit && a.unit !== b.unit) return false;

  const sharedTokens = intersection(a.tokens, b.tokens).length;
  const unionTokens = new Set([...a.tokens, ...b.tokens]).size;
  const tokenSimilarity = unionTokens === 0 ? 0 : sharedTokens / unionTokens;

  return tokenSimilarity >= 0.45 || Boolean(a.productMain && a.productMain === b.productMain && (!a.color || !b.color || a.color === b.color));
}

function buildGroupLabel(item: ParsedItem): string {
  const parts = [item.productMain, item.color, item.brand, item.model].filter(Boolean);
  if (parts.length) return titleCase(parts.join(' '));
  return 'Resultado sem produto identificado';
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function intersection<T>(a: T[], b: T[]): T[] {
  const bSet = new Set(b);
  return a.filter((item) => bSet.has(item));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export const clusterEngine = new ClusterEngine();
