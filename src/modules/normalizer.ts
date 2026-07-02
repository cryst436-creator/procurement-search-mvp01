import type { TextNormalizer } from '../domain/contracts.js';

const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/\b(unidade|unidades|unid\.?|un\.)\b/g, 'un'],
  [/\b(caixas|caixa|cx\.)\b/g, 'caixa'],
  [/\b(resmas|resma)\b/g, 'resma'],
  [/\b(mililitros|mililitro)\b/g, 'ml'],
  [/\b(litros|litro)\b/g, 'l'],
  [/\b(quilogramas|quilograma|kilos|quilo)\b/g, 'kg'],
  [/\b(gramas|grama)\b/g, 'g'],
  [/\b(gigabytes|gigabyte|giga)\b/g, 'gb'],
  [/\b(terabytes|terabyte|tera)\b/g, 'tb']
];

const PRODUCT_SYNONYMS: Array<[RegExp, string]> = [
  [/\besferografica\b/g, 'caneta esferografica'],
  [/\bcaneta bic\b/g, 'caneta bic'],
  [/\bmarca texto\b/g, 'marca-texto'],
  [/\bmarcador de texto\b/g, 'marca-texto'],
  [/\bcomputador portatil\b/g, 'notebook'],
  [/\bpapel sulfite\b/g, 'papel a4']
];

const BRAND_ALIASES: Array<[RegExp, string]> = [
  [/\bb\.i\.c\.?\b/g, 'bic'],
  [/\bhp inc\.?\b/g, 'hp']
];

export class Normalizer implements TextNormalizer {
  normalize(text: string): string {
    let output = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[“”"']/g, ' ')
      .replace(/\s*\/\s*/g, ' ')
      .replace(/[(),;:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    for (const [regex, replacement] of UNIT_ALIASES) output = output.replace(regex, replacement);
    for (const [regex, replacement] of BRAND_ALIASES) output = output.replace(regex, replacement);
    for (const [regex, replacement] of PRODUCT_SYNONYMS) output = output.replace(regex, replacement);

    output = output
      .replace(/(\d+)\s+(gb|tb|mb|kg|g|ml|l|mm|cm|m)\b/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();

    return output;
  }
}

export const normalizer = new Normalizer();
