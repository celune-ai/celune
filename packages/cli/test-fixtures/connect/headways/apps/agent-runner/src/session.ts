import { query } from '@anthropic-ai/claude-agent-sdk';

export async function runSession(prompt: string) {
  for await (const message of query({ prompt, options: { maxTurns: 20 } })) {
    console.log(message.type);
  }
}
