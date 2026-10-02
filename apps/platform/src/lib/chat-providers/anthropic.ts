import Anthropic from '@anthropic-ai/sdk';
import type { ChatProvider, StreamChatOptions, StreamChatResult, ChatMessage } from './types';

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export const anthropicProvider: ChatProvider = {
  async streamChat(opts: StreamChatOptions): Promise<StreamChatResult> {
    const client = new Anthropic({ apiKey: opts.apiKey });

    const stream = client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.systemPrompt,
      messages: toAnthropicMessages(opts.messages),
    });

    let fullResponse = '';
    const encoder = new TextEncoder();

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              const text = chunk.delta.text;
              fullResponse += text;
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          const isBilling = msg.includes('credit balance');
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
      getUsage: async () => {
        try {
          const final = await stream.finalMessage();
          return {
            inputTokens: final.usage?.input_tokens ?? 0,
            outputTokens: final.usage?.output_tokens ?? 0,
          };
        } catch {
          return null;
        }
      },
    };
  },
};
