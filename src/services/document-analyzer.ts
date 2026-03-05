/**
 * Document Analysis Service for NovaSupport
 * Parses PDF, TXT, and LOG files to extract text, error patterns,
 * stack traces, timestamps, and generates structured summaries.
 *
 * Requirements: 6.1 (parse PDF/TXT/LOG), 6.2 (error patterns/stack traces/timestamps),
 *               6.4 (structured summary), 6.5 (10MB size limit)
 */

import { DocumentAnalysis } from '../types/agent';
import { getFile } from '../utils/s3-client';
import { invokeNova2LiteWithFallback } from '../utils/nova-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('DocumentAnalyzer');

/** Maximum document size: 10MB */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

/** Supported document formats */
export type DocumentFormat = 'pdf' | 'txt' | 'log';

const SUPPORTED_FORMATS: DocumentFormat[] = ['pdf', 'txt', 'log'];

/**
 * Input for document analysis — either an S3 key or raw content.
 */
export interface DocumentInput {
  /** S3 object key for the document (mutually exclusive with content) */
  s3Key?: string;
  /** Raw document content as Buffer or string (mutually exclusive with s3Key) */
  content?: Buffer | string;
  /** Document format */
  format: DocumentFormat;
}

/**
 * Error thrown when document analysis fails.
 */
export class DocumentAnalysisError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'DocumentAnalysisError';
  }
}

/**
 * Detect document format from file name.
 */
export function detectDocumentFormat(fileName: string): DocumentFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'txt') return 'txt';
  if (ext === 'log') return 'log';
  return null;
}

/**
 * Validate that the given format is supported.
 */
export function isSupportedDocumentFormat(format: string): format is DocumentFormat {
  return SUPPORTED_FORMATS.includes(format as DocumentFormat);
}

/**
 * Regex patterns for common error indicators in logs/documents.
 */
const ERROR_PATTERNS: RegExp[] = [
  /\b(?:ERROR|FATAL|CRITICAL)\b[:\s].*/gi,
  /\w*Exception\b[:\s].*/gi,
  /\bError\b[:\s].*/gi,
  /\bWARN(?:ING)?\b[:\s].*/gi,
  /\bFAILED?\b[:\s].*/gi,
  /\bPANIC\b[:\s].*/gi,
];

/**
 * Regex patterns for stack trace lines.
 */
const STACK_TRACE_PATTERNS: RegExp[] = [
  /^\s+at\s+.+/gm,                          // Java/JS: "  at com.example.Class.method(File.java:42)"
  /^\s+File\s+"[^"]+",\s+line\s+\d+/gm,     // Python: '  File "script.py", line 10'
  /^\s+from\s+.+:\d+:in\s+/gm,              // Ruby: "  from app.rb:10:in `method'"
  /Traceback\s+\(most recent call last\)/gi,  // Python traceback header
  /Caused by:\s+.+/gi,                        // Java chained exceptions
];

/**
 * Regex patterns for common timestamp formats.
 */
const TIMESTAMP_PATTERNS: RegExp[] = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,  // ISO 8601
  /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?/g,                         // Common log: "2024-01-15 10:30:45.123"
  /\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4}/g,                       // Apache CLF: "15/Jan/2024:10:30:45 +0000"
  /\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/g,                                      // Syslog: "Jan 15 10:30:45"
];

/**
 * Extract text content from a document buffer based on format.
 */
export function extractText(content: Buffer | string, format: DocumentFormat): string {
  const text = typeof content === 'string' ? content : content.toString('utf-8');

  if (format === 'txt' || format === 'log') {
    return text;
  }

  if (format === 'pdf') {
    // Hackathon approach: extract readable text bytes from PDF.
    // A full PDF parser is out of scope; we strip binary/control chars
    // and return whatever readable text is embedded.
    if (content instanceof Buffer) {
      return extractTextFromPdf(content);
    }
    return extractTextFromPdf(Buffer.from(content as string, 'utf-8'));
  }

  return text;
}

/**
 * Simple PDF text extraction — extracts readable ASCII/UTF-8 text from raw PDF bytes.
 * This is a hackathon-level approach; for production, use a library like pdf-parse.
 */
function extractTextFromPdf(buffer: Buffer): string {
  const raw = buffer.toString('utf-8');

  // Try to extract text between BT (Begin Text) and ET (End Text) operators
  const textBlocks: string[] = [];
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;

  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    // Extract strings inside parentheses (PDF literal strings)
    const stringRegex = /\(([^)]*)\)/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = stringRegex.exec(block)) !== null) {
      if (strMatch[1].trim()) {
        textBlocks.push(strMatch[1]);
      }
    }
  }

  if (textBlocks.length > 0) {
    return textBlocks.join(' ');
  }

  // Fallback: strip non-printable characters and return whatever readable text exists
  const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return printable;
}

/**
 * Extract error patterns from text content.
 */
export function extractErrorPatterns(text: string): string[] {
  const errors = new Set<string>();

  for (const pattern of ERROR_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const errorLine = match[0].trim();
      if (errorLine.length > 0 && errorLine.length <= 500) {
        errors.add(errorLine);
      }
    }
  }

  return Array.from(errors);
}

/**
 * Extract stack traces from text content.
 */
export function extractStackTraces(text: string): string[] {
  const traces = new Set<string>();

  for (const pattern of STACK_TRACE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const traceLine = match[0].trim();
      if (traceLine.length > 0) {
        traces.add(traceLine);
      }
    }
  }

  return Array.from(traces);
}

/**
 * Extract timestamps from text content.
 */
export function extractTimestamps(text: string): Date[] {
  const timestamps: Date[] = [];
  const seen = new Set<string>();

  for (const pattern of TIMESTAMP_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      if (seen.has(raw)) continue;
      seen.add(raw);

      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        timestamps.push(parsed);
      }
    }
  }

  // Sort chronologically
  timestamps.sort((a, b) => a.getTime() - b.getTime());
  return timestamps;
}

/**
 * Build the prompt for Nova 2 Lite to generate a structured summary.
 */
function buildSummaryPrompt(text: string, errorPatterns: string[], stackTraces: string[]): string {
  // Truncate text to avoid exceeding token limits
  const truncatedText = text.length > 4000 ? text.substring(0, 4000) + '\n... [truncated]' : text;

  return `Analyze the following document content and provide a structured summary in JSON format.

Document content:
${truncatedText}

${errorPatterns.length > 0 ? `Detected error patterns:\n${errorPatterns.slice(0, 10).join('\n')}` : ''}
${stackTraces.length > 0 ? `Detected stack traces:\n${stackTraces.slice(0, 5).join('\n')}` : ''}

Respond with ONLY valid JSON in this format:
{
  "summary": "A concise summary of the document's content and key findings",
  "keyTechnicalDetails": {
    "key1": "value1",
    "key2": "value2"
  }
}

Rules:
- The summary should be 2-4 sentences describing the main content and any issues found.
- keyTechnicalDetails should contain important technical information like error codes, affected services, versions, file paths, etc.
- Return ONLY valid JSON, no additional text.`;
}

/**
 * Parse the summary response from Nova 2 Lite.
 */
export function parseSummaryResponse(responseText: string): { summary: string; keyTechnicalDetails: Record<string, string> } {
  try {
    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const keyTechnicalDetails: Record<string, string> = {};

    if (parsed.keyTechnicalDetails && typeof parsed.keyTechnicalDetails === 'object') {
      for (const [key, value] of Object.entries(parsed.keyTechnicalDetails)) {
        if (typeof value === 'string') {
          keyTechnicalDetails[key] = value;
        } else if (value !== null && value !== undefined) {
          keyTechnicalDetails[key] = String(value);
        }
      }
    }

    return { summary, keyTechnicalDetails };
  } catch {
    logger.warn('Failed to parse Nova summary response as JSON', {
      responseLength: responseText.length,
    });
    return {
      summary: responseText.substring(0, 500),
      keyTechnicalDetails: {},
    };
  }
}

/**
 * Generate a rule-based fallback summary when Nova is unavailable.
 */
export function generateFallbackSummary(
  text: string,
  errorPatterns: string[],
  stackTraces: string[],
  timestamps: Date[]
): { summary: string; keyTechnicalDetails: Record<string, string> } {
  const parts: string[] = [];

  if (errorPatterns.length > 0) {
    parts.push(`Found ${errorPatterns.length} error pattern(s).`);
  }
  if (stackTraces.length > 0) {
    parts.push(`Found ${stackTraces.length} stack trace line(s).`);
  }
  if (timestamps.length > 0) {
    const first = timestamps[0].toISOString();
    const last = timestamps[timestamps.length - 1].toISOString();
    parts.push(`Timestamps range from ${first} to ${last}.`);
  }

  const lineCount = text.split('\n').length;
  parts.push(`Document contains ${lineCount} line(s) of text.`);

  const keyTechnicalDetails: Record<string, string> = {};
  if (errorPatterns.length > 0) {
    keyTechnicalDetails['errorCount'] = String(errorPatterns.length);
    keyTechnicalDetails['firstError'] = errorPatterns[0].substring(0, 200);
  }
  if (stackTraces.length > 0) {
    keyTechnicalDetails['stackTraceLines'] = String(stackTraces.length);
  }
  if (timestamps.length > 0) {
    keyTechnicalDetails['timeRange'] = `${timestamps[0].toISOString()} to ${timestamps[timestamps.length - 1].toISOString()}`;
  }

  return {
    summary: parts.join(' ') || 'Document analyzed but no significant patterns detected.',
    keyTechnicalDetails,
  };
}

/**
 * Analyze a document and return structured analysis results.
 *
 * Accepts either an S3 key (fetches the document from S3) or raw content.
 * Parses PDF, TXT, and LOG files, extracts error patterns, stack traces,
 * timestamps, and generates a structured summary using Nova 2 Lite.
 *
 * Falls back to rule-based analysis when Nova is unavailable.
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5
 */
export async function analyzeDocument(input: DocumentInput): Promise<DocumentAnalysis> {
  logger.info('Starting document analysis', {
    hasS3Key: !!input.s3Key,
    hasContent: !!input.content,
    format: input.format,
  });

  if (!isSupportedDocumentFormat(input.format)) {
    throw new DocumentAnalysisError(`Unsupported document format: ${input.format}`);
  }

  // Resolve document content
  let rawContent: Buffer | string;
  if (input.content !== undefined) {
    rawContent = input.content;
  } else if (input.s3Key) {
    try {
      rawContent = await getFile(input.s3Key);
    } catch (error: any) {
      logger.error('Failed to fetch document from S3', error, { s3Key: input.s3Key });
      throw new DocumentAnalysisError(`Failed to fetch document from S3: ${error.message}`, error);
    }
  } else {
    throw new DocumentAnalysisError('Either s3Key or content must be provided');
  }

  // Enforce 10MB size limit
  const sizeBytes = typeof rawContent === 'string' ? Buffer.byteLength(rawContent, 'utf-8') : rawContent.length;
  if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
    throw new DocumentAnalysisError(
      `Document exceeds maximum size of 10MB (actual: ${(sizeBytes / (1024 * 1024)).toFixed(2)}MB)`
    );
  }

  // Extract text
  const extractedText = extractText(rawContent, input.format);

  // Extract patterns
  const errorPatterns = extractErrorPatterns(extractedText);
  const stackTraces = extractStackTraces(extractedText);
  const timestamps = extractTimestamps(extractedText);

  // Generate summary using Nova 2 Lite with fallback
  let summary: string;
  let keyTechnicalDetails: Record<string, string>;

  try {
    const prompt = buildSummaryPrompt(extractedText, errorPatterns, stackTraces);
    const fallback = generateFallbackSummary(extractedText, errorPatterns, stackTraces, timestamps);

    const response = await invokeNova2LiteWithFallback(
      { prompt, temperature: 0.3, maxTokens: 1024 },
      JSON.stringify({ summary: fallback.summary, keyTechnicalDetails: fallback.keyTechnicalDetails })
    );

    const parsed = parseSummaryResponse(response.text);
    summary = parsed.summary;
    keyTechnicalDetails = parsed.keyTechnicalDetails;
  } catch (error: any) {
    logger.warn('Summary generation failed, using fallback', { error: error.message });
    const fallback = generateFallbackSummary(extractedText, errorPatterns, stackTraces, timestamps);
    summary = fallback.summary;
    keyTechnicalDetails = fallback.keyTechnicalDetails;
  }

  logger.info('Document analysis complete', {
    extractedTextLength: extractedText.length,
    errorPatternCount: errorPatterns.length,
    stackTraceCount: stackTraces.length,
    timestampCount: timestamps.length,
  });

  return {
    extractedText,
    errorPatterns,
    stackTraces,
    timestamps,
    summary,
    keyTechnicalDetails,
  };
}
