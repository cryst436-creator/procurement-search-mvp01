import type { StopWordsProcessor } from '../domain/contracts.js';

const BASE_STOP_WORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'para', 'por', 'em', 'no', 'na', 'nos', 'nas',
  'aquisicao', 'contratacao', 'fornecimento', 'objeto', 'item', 'itens', 'material', 'servico', 'publico', 'publica'
]);

const PROTECTED = new Set([
  'nao', 'sem', 'exceto', 'incompativel', 'azul', 'vermelho', 'vermelha', 'preto', 'preta', 'branco', 'branca',
  'verde', 'amarelo', 'amarela', 'bic', 'dell', 'hp', 'lenovo', 'samsung', 'inspiron', 'cristal', 'ssd', 'ram', 'usb',
  'un', 'caixa', 'resma', 'kg', 'g', 'ml', 'l', 'gb', 'tb', 'mm', 'cm', 'm', 'com'
]);

export class StopWords implements StopWordsProcessor {
  filter(tokens: string[]): string[] {
    return tokens.filter((token, index, all) => {
      if (!token.trim()) return false;
      if (PROTECTED.has(token)) return true;
      if (/\d/.test(token)) return true;

      // Preserve phrases like "com tampa", "com clipe", "com 50".
      if (token === 'com') {
        const next = all[index + 1];
        return Boolean(next && !BASE_STOP_WORDS.has(next));
      }

      return !BASE_STOP_WORDS.has(token);
    });
  }
}

export const stopWords = new StopWords();
