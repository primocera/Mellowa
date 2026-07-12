import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";

/**
 * SERVER-ONLY AI provider client. Currently Anthropic; the rest of the app
 * only talks to generateStructuredJson so the provider can be swapped later.
 */
let client: Anthropic | null = null;

export function getAiClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: serverEnv.aiApiKey });
  }
  return client;
}

export function getAiModel(): string {
  return serverEnv.aiModel;
}
