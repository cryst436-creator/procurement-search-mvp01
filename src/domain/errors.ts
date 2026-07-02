export class SearchEngineError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SearchEngineError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: string, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ExtractionError';
  }
}
