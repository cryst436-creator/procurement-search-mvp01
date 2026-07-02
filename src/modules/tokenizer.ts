import type { ItemTokenizer, StopWordsProcessor, TextNormalizer } from '../domain/contracts.js';
import type { ParsedItem } from '../domain/types.js';
import { normalizer as defaultNormalizer } from './normalizer.js';
import { stopWords as defaultStopWords } from './stopWords.js';

const COLORS = new Set(['azul', 'vermelho', 'vermelha', 'preto', 'preta', 'branco', 'branca', 'verde', 'amarelo', 'amarela', 'rosa', 'roxo', 'roxa', 'cinza', 'transparente']);
const COLOR_CANONICAL: Record<string, string> = {
  vermelha: 'vermelho',
  preta: 'preto',
  branca: 'branco',
  amarela: 'amarelo',
  roxa: 'roxo'
};

const BRANDS = new Set(['bic', 'dell', 'hp', 'lenovo', 'samsung', 'pilot', 'compactor', 'faber', 'multilaser', 'positivo', 'acer', 'asus']);
const UNITS = new Set(['un', 'caixa', 'resma', 'kg', 'g', 'ml', 'l', 'gb', 'tb', 'mm', 'cm', 'm']);
const PRODUCTS = new Set([
  'caneta', 'notebook', 'papel', 'mouse', 'teclado', 'monitor', 'impressora', 'marca-texto', 'refil', 'toner', 'cartucho',
  'lapiseira', 'borracha', 'grampeador', 'pasta', 'cadeira', 'mesa'
]);

const PRODUCT_CATEGORY: Record<string, string> = {
  caneta: 'material_escritorio',
  'marca-texto': 'material_escritorio',
  refil: 'acessorio_material_escritorio',
  lapiseira: 'material_escritorio',
  papel: 'papelaria',
  notebook: 'informatica',
  mouse: 'informatica',
  teclado: 'informatica',
  monitor: 'informatica',
  impressora: 'informatica',
  toner: 'suprimento_impressao',
  cartucho: 'suprimento_impressao',
  cadeira: 'mobiliario',
  mesa: 'mobiliario'
};

export class Tokenizer implements ItemTokenizer {
  constructor(
    private readonly normalizer: TextNormalizer = defaultNormalizer,
    private readonly stopWords: StopWordsProcessor = defaultStopWords
  ) {}

  tokenize(text: string): ParsedItem {
    const normalizedText = this.normalizer.normalize(text);
    const rawTokens = normalizedText.split(/\s+/).filter(Boolean);
    const tokens = this.stopWords.filter(rawTokens);

    const item: ParsedItem = {
      technicalSpecs: {},
      normalizedText,
      tokens,
      confidence: 0.7
    };

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const next = tokens[i + 1];
      const pair = next ? `${token} ${next}` : token;

      if (!item.productMain && PRODUCTS.has(token)) {
        item.productMain = token;
        item.category = PRODUCT_CATEGORY[token];
      }

      if (!item.productMain && PRODUCTS.has(pair)) {
        item.productMain = pair;
        item.category = PRODUCT_CATEGORY[pair];
      }

      if (!item.color && COLORS.has(token)) item.color = COLOR_CANONICAL[token] ?? token;
      if (!item.brand && BRANDS.has(token)) item.brand = token;
      if (!item.unit && UNITS.has(token)) item.unit = token;

      if (/^i[3579]$/.test(token)) item.technicalSpecs.processor = token;
      if (/^ryzen$/.test(token) && next && /^\d$/.test(next)) item.technicalSpecs.processor = `${token} ${next}`;
      if (/^\d+gb$/.test(token)) {
        const previous = tokens[i - 1];
        if (previous === 'ram') item.technicalSpecs.ram = token;
        else if (tokens.includes('ssd') || tokens.includes('hd')) item.technicalSpecs.storageSize ??= token;
        else item.technicalSpecs.capacity ??= token;
      }
      if (token === 'ssd' || token === 'hd') item.technicalSpecs.storageType = token;
      if (/^\d+(mm|cm|ml|l|kg|g)$/.test(token)) item.technicalSpecs[`measure_${i}`] = token;
      if (/^a\d$/.test(token)) item.technicalSpecs.paperSize = token;
      if (token === 'tampa' || token === 'clipe' || token === 'transparente' || token === 'optico' || token === 'usb') {
        item.technicalSpecs[token] = true as unknown as string;
      }
    }

    // Heuristic model extraction: tokens after brand that are not color/unit/spec/product.
    if (item.brand) {
      const brandIndex = tokens.indexOf(item.brand);
      const modelTokens = tokens.slice(brandIndex + 1).filter((t) =>
        !COLORS.has(t) && !UNITS.has(t) && !PRODUCTS.has(t) && !/^\d+(gb|tb|mb|kg|g|ml|l|mm|cm|m)$/.test(t) && t !== 'ssd' && t !== 'ram'
      );
      if (modelTokens.length) item.model = modelTokens.slice(0, 3).join(' ');
    }

    if (item.productMain) item.confidence += 0.1;
    if (item.brand) item.confidence += 0.05;
    if (item.model) item.confidence += 0.05;
    if (item.color) item.confidence += 0.05;
    item.confidence = Math.min(1, item.confidence);

    return item;
  }
}

export const tokenizer = new Tokenizer();
