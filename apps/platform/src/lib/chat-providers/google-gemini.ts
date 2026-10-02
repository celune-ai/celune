import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ChatProvider, StreamChatOptions, StreamChatResult } from './types';

export const googleGeminiProvider: ChatProvider = {
  async streamChat(opts: StreamChatOptions): Promise<StreamChatResult> {
    const genAI = new GoogleGenerativeAI(opts.apiKey);
    const model = genAI.getGenerativeModel({ model: opts.model });

    const encoder = new TextEncoder();
    let totalTokens = 0;

    // Convert messages to Gemini format (history + last user message)
    const history = opts.messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }));

    const lastMessage = opts.messages[opts.messages.length - 1];

    const chat = model.startChat({
      history,
      systemInstruction: { role: 'user' as const, parts: [{ text: opts.systemPrompt }] },
    });

    const result = await chat.sendMessageStream(lastMessage?.content ?? '');

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }

          // Get usage after streaming
          const response = await result.response;
          const usage = response.usageMetadata;
          if (usage) {
            totalTokens = (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0);
          }

          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          const isBilling = msg.includes('quota') || msg.includes('billing');
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
        const response = await result.response;
        const usage = response.usageMetadata;
        return {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
        };
      },
    };
  },
};
