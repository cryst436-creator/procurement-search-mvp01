import { describe, expect, it } from 'vitest';
import { Normalizer } from '../src/modules/normalizer.js';
import { Tokenizer } from '../src/modules/tokenizer.js';

const normalizer = new Normalizer();
const tokenizer = new Tokenizer(normalizer);

describe('Normalizer', () => {
  it('lowercases, removes accents and standardizes units', () => {
    expect(normalizer.normalize('Caneta AZUL BIC Cristal')).toBe('caneta azul bic cristal');
    expect(normalizer.normalize('SSD 512 GB')).toContain('512gb');
    expect(normalizer.normalize('CX com 50 unidades')).toContain('caixa');
  });
});

describe('Tokenizer', () => {
  it('parses Caneta Azul Bic Cristal', () => {
    const parsed = tokenizer.tokenize('Caneta Azul Bic Cristal');
    expect(parsed.productMain).toBe('caneta');
    expect(parsed.color).toBe('azul');
    expect(parsed.brand).toBe('bic');
    expect(parsed.model).toBe('cristal');
  });

  it('parses notebook specs', () => {
    const parsed = tokenizer.tokenize('Notebook Dell Inspiron 15 i5 16GB SSD 512GB');
    expect(parsed.productMain).toBe('notebook');
    expect(parsed.brand).toBe('dell');
    expect(parsed.model).toContain('inspiron');
    expect(parsed.technicalSpecs.processor).toBe('i5');
    expect(parsed.technicalSpecs.storageType).toBe('ssd');
  });
});
