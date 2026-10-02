/**
 * Type declarations for optional dependencies used via dynamic import.
 * These packages are not installed but are used with try/catch fallbacks.
 */

declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    version: string;
    text: string;
  }

  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}

declare module 'mammoth' {
  interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  interface MammothOptions {
    buffer?: Buffer;
    path?: string;
  }

  function extractRawText(options: MammothOptions): Promise<MammothResult>;
  function convertToHtml(options: MammothOptions): Promise<MammothResult>;

  export default {
    extractRawText,
    convertToHtml,
  };
}
