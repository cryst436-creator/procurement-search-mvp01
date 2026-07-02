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

const BRANDS = new Set(['bic', 'dell', 'hp', 'lenovo', 'samsung', 'pilot', 'compactor', 'faber', 'faber-castell', 'multilaser', 'positivo', 'acer', 'asus', 'epson', 'canon', 'brother', 'logitech']);
const UNITS = new Set(['un', 'und', 'unidade', 'caixa', 'cx', 'pacote', 'pct', 'resma', 'kg', 'g', 'ml', 'l', 'gb', 'tb', 'mm', 'cm', 'm']);
const UNIT_CANONICAL: Record<string, string> = {
  und: 'un',
  unidade: 'un',
  cx: 'caixa',
  pct: 'pacote'
};

const PRODUCTS = new Set([
  'caneta', 'notebook', 'papel', 'mouse', 'teclado', 'monitor', 'impressora', 'marca-texto', 'refil', 'toner', 'cartucho',
  'lapiseira', 'borracha', 'grampeador', 'pasta', 'cadeira', 'mesa', 'computador', 'tablet', 'scanner', 'webcam',
  'projetor', 'roteador', 'switch', 'cabo', 'adaptador', 'estabilizador', 'nobreak', 'envelope', 'cola', 'tesoura',
  'corretivo', 'clipe', 'grampo', 'arquivo', 'caixa', 'alcool', 'detergente', 'sabonete', 'papel-higienico'
]);

const PRODUCT_ALIASES: Record<string, string> = {
  'marca texto': 'marca-texto',
  marcatexto: 'marca-texto',
  esferografica: 'caneta',
  esferografico: 'caneta',
  microcomputador: 'computador',
  desktop: 'computador',
  pc: 'computador',
  impressoras: 'impressora',
  cartuchos: 'cartucho',
  toners: 'toner',
  'papel higienico': 'papel-higienico'
};

const PRODUCT_CATEGORY: Record<string, string> = {
  caneta: 'material_escritorio',
  'marca-texto': 'material_escritorio',
  refil: 'acessorio_material_escritorio',
  lapiseira: 'material_escritorio',
  borracha: 'material_escritorio',
  grampeador: 'material_escritorio',
  clipe: 'material_escritorio',
  grampo: 'material_escritorio',
  papel: 'papelaria',
  envelope: 'papelaria',
  pasta: 'papelaria',
  arquivo: 'papelaria',
  cola: 'papelaria',
  tesoura: 'papelaria',
  corretivo: 'papelaria',
  notebook: 'informatica',
  computador: 'informatica',
  tablet: 'informatica',
  mouse: 'informatica',
  teclado: 'informatica',
  monitor: 'informatica',
  impressora: 'informatica',
  scanner: 'informatica',
  webcam: 'informatica',
  projetor: 'informatica',
  roteador: 'informatica',
  switch: 'informatica',
  cabo: 'informatica_acessorio',
  adaptador: 'informatica_acessorio',
  estabilizador: 'informatica_acessorio',
  nobreak: 'informatica_acessorio',
  toner: 'suprimento_impressao',
  cartucho: 'suprimento_impressao',
  cadeira: 'mobiliario',
  mesa: 'mobiliario',
  alcool: 'limpeza',
  detergente: 'limpeza',
  sabonete: 'higiene',
  'papel-higienico': 'higiene'
};

export class Tokenizer implements ItemTokenizer {
  constructor(
    private readonly normalizer: TextNormalizer = defaultNormalizer,
    private readonly stopWords: StopWordsProcessor = defaultStopWords
  ) {}

  tokenize(text: string): ParsedItem {
    const normalizedText = this.normalizer.normalize(text).replace(/marca\s+texto/g, 'marca-texto').replace(/papel\s+higienico/g, 'papel-higienico');
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
      const canonicalToken = PRODUCT_ALIASES[token] ?? singularize(token);
      const canonicalPair = PRODUCT_ALIASES[pair] ?? pair;

      if (!item.productMain && PRODUCTS.has(canonicalToken)) {
        item.productMain = canonicalToken;
        item.category = PRODUCT_CATEGORY[canonicalToken];
      }

      if (!item.productMain && PRODUCTS.has(canonicalPair)) {
        item.productMain = canonicalPair;
        item.category = PRODUCT_CATEGORY[canonicalPair];
      }

      if (!item.color && COLORS.has(token)) item.color = COLOR_CANONICAL[token] ?? token;
      if (!item.brand && BRANDS.has(token)) item.brand = token;
      if (!item.unit && UNITS.has(token)) item.unit = UNIT_CANONICAL[token] ?? token;

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
      if (token === 'tampa' || token === 'clipe' || token === 'transparente' || token === 'optico' || token === 'usb' || token === 'ponta' || token === 'cristal') {
        item.technicalSpecs[token] = true as unknown as string;
      }
    }

    // Heuristic model extraction: tokens after brand that are not color/unit/spec/product.
    if (item.brand) {
      const brandIndex = tokens.indexOf(item.brand);
      const modelTokens = tokens.slice(brandIndex + 1).filter((t) =>
        !COLORS.has(t) && !UNITS.has(t) && !PRODUCTS.has(PRODUCT_ALIASES[t] ?? singularize(t)) && !/^\d+(gb|tb|mb|kg|g|ml|l|mm|cm|m)$/.test(t) && t !== 'ssd' && t !== 'ram'
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

function singularize(token: string): string {
  if (PRODUCTS.has(token)) return token;
  if (token.endsWith('oes')) return `${token.slice(0, -3)}ao`;
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

export const tokenizer = new Tokenizer();
