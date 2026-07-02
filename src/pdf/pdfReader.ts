import type { DocumentReader } from '../domain/contracts.js';
import type { ExtractedDocument, RawDocumentRef } from '../domain/types.js';

export class PDFReader implements DocumentReader {
  async extract(ref: RawDocumentRef): Promise<ExtractedDocument> {
    if (ref.inlineText) {
      return {
        ref,
        text: ref.inlineText,
        tables: inferSimpleTables(ref.inlineText),
        sections: [{ page: 1, title: ref.documentType, text: ref.inlineText, charStart: 0, charEnd: ref.inlineText.length }],
        extractionConfidence: 1,
        warnings: []
      };
    }

    if (!ref.documentUrl) {
      return {
        ref,
        text: '',
        tables: [],
        sections: [],
        extractionConfidence: 0,
        warnings: ['Document URL missing. Metadata was preserved but PDF extraction could not run.']
      };
    }

    // MVP integration seam:
    // Replace this with a Python worker using PyMuPDF/pdfplumber/Tesseract.
    // Keeping it isolated prevents PDF libraries from leaking into SearchEngine.
    return {
      ref,
      text: '',
      tables: [],
      sections: [],
      extractionConfidence: 0,
      warnings: [
        `PDF extraction worker not connected yet for ${ref.documentUrl}. Use the Python worker seam described in README.`
      ]
    };
  }
}

function inferSimpleTables(text: string) {
  const itemLines = text.split(/\n|\.\s+/).filter((line) => /\bitem\s+\d+/i.test(line));
  if (!itemLines.length) return [];
  return [
    {
      page: 1,
      rows: itemLines.map((line) => [line.trim()]),
      confidence: 0.6
    }
  ];
}
