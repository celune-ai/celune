/**
 * Unified chat provider interface.
 *
 * All providers return a ReadableStream<Uint8Array> of text chunks.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  systemPrompt: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
}

export interface StreamChatResult {
  /** ReadableStream of UTF-8 text chunks */
  stream: ReadableStream<Uint8Array>;
  /** Promise that resolves to token usage after streaming completes */
  getUsage: () => Promise<{ inputTokens: number; outputTokens: number } | null>;
}

export interface ChatProvider {
  streamChat(opts: StreamChatOptions): Promise<StreamChatResult>;
}
