import type { DocumentReader } from '../domain/contracts.js';
import type { ExtractedDocument, RawDocumentRef } from '../domain/types.js';

export class PDFReader implements DocumentReader {
  async extract(ref: RawDocumentRef): Promise<ExtractedDocument> {
    if (ref.inlineText) {
      return toExtractedDocument(ref, ref.inlineText, 1, []);
    }

    const metadataText = buildMetadataText(ref);

    if (!ref.documentUrl) {
      return toExtractedDocument(
        ref,
        metadataText,
        metadataText ? 0.45 : 0,
        metadataText
          ? ['Document URL missing. Using metadata as searchable fallback text.']
          : ['Document URL missing. Metadata was preserved but extraction could not run.']
      );
    }

    const fetched = await tryFetchText(ref.documentUrl);
    if (fetched.text) return toExtractedDocument(ref, fetched.text, fetched.confidence, fetched.warnings);

    return toExtractedDocument(
      ref,
      metadataText,
      metadataText ? 0.35 : 0,
      [
        ...fetched.warnings,
        metadataText
          ? 'Document extraction was not reliable. Using metadata as searchable fallback text.'
          : `Document extraction failed and no metadata fallback was available for ${ref.documentUrl}.`
      ]
    );
  }
}

function toExtractedDocument(ref: RawDocumentRef, text: string, extractionConfidence: number, warnings: string[]): ExtractedDocument {
  return {
    ref,
    text,
    tables: inferSimpleTables(text),
    sections: text ? [{ page: 1, title: ref.documentType, text, charStart: 0, charEnd: text.length }] : [],
    extractionConfidence,
    warnings
  };
}

async function tryFetchText(url: string): Promise<{ text: string; confidence: number; warnings: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.PDF_FETCH_TIMEOUT_MS ?? 15000));

    try {
      const response = await fetch(url, { headers: { accept: 'text/plain,*/*' }, signal: controller.signal });
      if (!response.ok) return { text: '', confidence: 0, warnings: [`Document fetch returned HTTP ${response.status} for ${url}.`] };

      const contentType = response.headers.get('content-type') ?? '';
      const raw = Buffer.from(await response.arrayBuffer()).toString('utf-8');
      const text = cleanText(raw);

      if (contentType.includes('text') && text.length >= 80) return { text: text.slice(0, 120000), confidence: 0.9, warnings: [] };
      if (text.length >= 500 && looksUseful(text)) {
        return {
          text: text.slice(0, 120000),
          confidence: 0.55,
          warnings: ['Document was decoded with a lightweight fallback extractor. Use a dedicated PDF worker later for higher accuracy.']
        };
      }

      return { text: '', confidence: 0, warnings: ['Document fetched but lightweight extraction did not find reliable text.'] };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { text: '', confidence: 0, warnings: [`Document fetch unavailable: ${error instanceof Error ? error.message : 'unknown error'}.`] };
  }
}

function cleanText(value: string): string {
  return value.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksUseful(text: string): boolean {
  const lower = text.toLowerCase();
  return ['edital', 'pregao', 'licita', 'contrato', 'objeto', 'item', 'quantidade', 'unidade'].some((word) => lower.includes(word));
}

function buildMetadataText(ref: RawDocumentRef): string {
  return [
    ref.documentType,
    ref.organization,
    ref.municipio,
    ref.uf,
    ref.processNumber ? `Processo ${ref.processNumber}` : undefined,
    ref.editalNumber ? `Edital ou compra ${ref.editalNumber}` : undefined,
    ref.modalidade,
    ref.publicationDate,
    metadataToText(ref.rawMetadata)
  ].filter((value) => typeof value === 'string' && value.trim().length > 0).join('. ');
}

function metadataToText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const parts: string[] = [];
  walk(value, parts, 0);
  return parts.join('. ');
}

function walk(value: unknown, parts: string[], depth: number): void {
  if (depth > 2 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) walk(item, parts, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (typeof nested === 'string' && nested.trim().length > 1) parts.push(`${key}: ${nested.trim()}`);
    else if (typeof nested === 'number') parts.push(`${key}: ${nested}`);
    else if (nested && typeof nested === 'object') walk(nested, parts, depth + 1);
  }
}

function inferSimpleTables(text: string) {
  const itemLines = text.split(/\n|\.\s+/).filter((line) => /\bitem\s+\d+|\bquantidade\b|\bunidade\b/i.test(line));
  if (!itemLines.length) return [];
  return [
    {
      page: 1,
      rows: itemLines.map((line) => [line.trim()]),
      confidence: 0.6
    }
  ];
}
