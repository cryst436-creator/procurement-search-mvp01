import { describe, expect, it } from 'vitest';
import { createDefaultSearchEngine } from '../src/modules/searchEngine.js';

describe('SearchEngine', () => {
  it('returns grouped explainable results from mock provider', async () => {
    process.env.ENABLE_MOCK_PROVIDER = 'true';
    const engine = createDefaultSearchEngine();
    const response = await engine.search({ query: 'Caneta Azul Bic Cristal', sources: ['MOCK'], uf: 'SC' });
    expect(response.totalResults).toBeGreaterThan(0);
    expect(response.groups[0].results[0].explanations.length).toBeGreaterThan(0);
    expect(response.groups[0].results[0].linkOficial).toContain('http');
  });
});
