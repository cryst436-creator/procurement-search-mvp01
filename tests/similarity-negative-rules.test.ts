import { describe, expect, it } from 'vitest';
import { Tokenizer } from '../src/modules/tokenizer.js';
import { SimilarityEngine } from '../src/modules/similarityEngine.js';
import type { MatchCandidate } from '../src/domain/types.js';

const tokenizer = new Tokenizer();
const engine = new SimilarityEngine();

function candidate(text: string): MatchCandidate {
  return {
    document: {
      ref: {
        id: `doc-${Math.random()}`,
        source: 'MOCK',
        officialUrl: 'https://pncp.gov.br/mock',
        documentType: 'EDITAL',
        organization: 'Prefeitura Teste',
        municipio: 'Treviso',
        uf: 'SC',
        publicationDate: '2026-06-01'
      },
      text,
      tables: [],
      sections: [{ text }],
      extractionConfidence: 1,
      warnings: []
    },
    item: tokenizer.tokenize(text),
    excerpt: text,
    lexicalScore: 1
  };
}

describe('SimilarityEngine negative rules', () => {
  it('scores exact caneta match high', () => {
    const query = tokenizer.tokenize('caneta azul bic cristal');
    const [result] = engine.score(query, [candidate('Caneta esferográfica azul Bic Cristal corpo transparente unidade')]);
    expect(result.similaridade).toBeGreaterThanOrEqual(85);
  });

  it('caps incompatible color', () => {
    const query = tokenizer.tokenize('caneta azul bic cristal');
    const [result] = engine.score(query, [candidate('Caneta esferográfica vermelha Bic Cristal corpo transparente unidade')]);
    expect(result.similaridade).toBeLessThanOrEqual(55);
    expect(result.explanations.some((e) => e.criterion === 'negativeRule')).toBe(true);
  });

  it('caps category conflict caneta vs marca-texto', () => {
    const query = tokenizer.tokenize('caneta azul');
    const [result] = engine.score(query, [candidate('Marca-texto azul ponta chanfrada unidade')]);
    expect(result.similaridade).toBeLessThanOrEqual(35);
  });

  it('caps refil vs product principal', () => {
    const query = tokenizer.tokenize('caneta azul');
    const [result] = engine.score(query, [candidate('Refil para caneta azul compatível com Bic Cristal')]);
    expect(result.similaridade).toBeLessThanOrEqual(45);
  });
});
