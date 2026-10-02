import OpenAI from 'openai';
import type { ChatProvider, StreamChatOptions, StreamChatResult } from './types';

export const openaiCompatibleProvider: ChatProvider = {
  async streamChat(opts: StreamChatOptions): Promise<StreamChatResult> {
    const client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    });

    const encoder = new TextEncoder();
    let inputTokens = 0;
    let outputTokens = 0;

    const openaiStream = await client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...opts.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of openaiStream) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              controller.enqueue(encoder.encode(delta));
            }
            // Capture usage from the final chunk
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0;
              outputTokens = chunk.usage.completion_tokens ?? 0;
            }
          }
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          const isBilling =
            msg.includes('insufficient_quota') || msg.includes('billing') || msg.includes('credit');
          const errorPayload = JSON.stringify({
            __error: true,
            billing: isBilling,
            message: isBilling ? 'Your API key has insufficient credits.' : msg,
          });
          controller.enqueue(encoder.encode(errorPayload));
          controller.close();
        }
      },
    });

    return {
      stream: readable,
      getUsage: async () => ({ inputTokens, outputTokens }),
    };
  },
};
