/**
 * AI provider abstraction (Task 0007, plan sections 28-29).
 *
 * Modes: disabled (default) | local | external. Local providers use an
 * OpenAI-compatible chat-completions endpoint; the same client serves an
 * external provider — the difference is privacy configuration, which
 * pseudonymizes all egress for external mode.
 *
 * The agent loop: system prompt (read-only investigator) + user question,
 * function-calling loop over the tool registry, bounded iterations.
 */
import { DEFAULT_PRIVACY, pseudonymize, AliasMap, type PrivacyConfig } from './privacy.js';
import { runTool, INVESTIGATION_TOOLS, type ToolContext } from './tools.js';

export type ProviderMode = 'disabled' | 'local' | 'external';

export interface ProviderConfig {
  readonly mode: ProviderMode;
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1. */
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly model: string | null;
  /** External egress privacy (defaults: all identifiers pseudonymized). */
  readonly privacy: PrivacyConfig;
}

export const DISABLED_PROVIDER: ProviderConfig = {
  mode: 'disabled',
  baseUrl: null,
  apiKey: null,
  model: null,
  privacy: DEFAULT_PRIVACY
};

/** Load provider config from environment; anything missing => disabled. */
export function loadProviderConfig(): ProviderConfig {
  const mode = process.env.AI_PROVIDER_MODE;
  const baseUrl = process.env.AI_PROVIDER_BASE_URL ?? null;
  const apiKey = process.env.AI_PROVIDER_API_KEY ?? null;
  const model = process.env.AI_PROVIDER_MODEL ?? null;
  if (mode !== 'local' && mode !== 'external') return DISABLED_PROVIDER;
  if (!baseUrl || !model) return DISABLED_PROVIDER;

  return {
    mode,
    baseUrl,
    apiKey,
    model,
    privacy: {
      allowMac: mode === 'local' || process.env.AI_EGRESS_ALLOW_MAC === 'true',
      allowIp: mode === 'local' || process.env.AI_EGRESS_ALLOW_IP === 'true',
      allowNames: mode === 'local' || process.env.AI_EGRESS_ALLOW_NAMES === 'true'
    }
  };
}

export interface EvidenceLink {
  readonly evidenceKind: 'telemetry_snapshot' | 'presence_event' | 'device' | 'audit_event';
  readonly evidenceId: string;
}

export interface InvestigationResult {
  readonly finding: string;
  readonly evidence: readonly EvidenceLink[];
}

const MAX_ITERATIONS = 8;
const SYSTEM_PROMPT = `You are a read-only network investigation assistant for a self-hosted router console.
Investigate the user's question using the provided tools. Tools are strictly read-only.
Ground every claim in tool results and cite evidence ids in your answer.
Never claim to have changed anything. Never invent data.`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

/**
 * Run one investigation: bounded agent loop over the OpenAI-compatible
 * endpoint with the read-only tool registry.
 */
export async function runInvestigation(
  config: ProviderConfig,
  ctx: ToolContext,
  question: string
): Promise<InvestigationResult> {
  if (config.mode === 'disabled') {
    throw new Error('AI provider is disabled');
  }

  const aliases = new AliasMap();
  // The question itself flows to the provider; pseudonymize identifiers
  // found in it for external providers.
  const safeQuestion =
    config.mode === 'external' ? pseudonymize(question, config.privacy, aliases) : question;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: typeof safeQuestion === 'string' ? safeQuestion : question }
  ];
  const evidence: EvidenceLink[] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await chatCompletion(config, messages);
    const choice = response.choices?.[0];
    if (!choice) break;
    const message = choice.message as ChatMessage & { tool_calls?: ChatMessage['tool_calls'] };

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { finding: message.content ?? '', evidence };
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      let result: unknown = null;
      try {
        const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        // Tools that fetch evidence ground the finding: record the link.
        if (call.function.name === 'evidence_lookup') {
          const kind = args['evidenceKind'] as EvidenceLink['evidenceKind'] | undefined;
          const id = args['evidenceId'] as string | undefined;
          if (kind && id) evidence.push({ evidenceKind: kind, evidenceId: id });
        }
        result = await runTool(ctx, call.function.name, args);
      } catch {
        result = null;
      }
      // Egress privacy: pseudonymize every tool result leaving the app
      // for external providers.
      const safeResult =
        config.mode === 'external' ? pseudonymize(result, config.privacy, aliases) : result;
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(safeResult ?? { error: 'unavailable' })
      });
    }
  }

  // Iterations exhausted: ask for the final answer without tools.
  messages.push({ role: 'user', content: 'Summarize your findings now with evidence ids.' });
  const final = await chatCompletion(config, messages);
  const finalMessage = final.choices?.[0]?.message as ChatMessage | undefined;
  return { finding: finalMessage?.content ?? '', evidence };
}

async function chatCompletion(
  config: ProviderConfig,
  messages: ChatMessage[]
): Promise<{ choices?: Array<{ message?: ChatMessage }> }> {
  const body = {
    model: config.model,
    messages,
    tools: INVESTIGATION_TOOLS.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toolSchema(tool.name)
      }
    }))
  };

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    throw new Error(`provider HTTP ${response.status}`);
  }
  return (await response.json()) as { choices?: Array<{ message?: ChatMessage }> };
}

/** JSON schema per tool for the function-calling protocol. */
function toolSchema(name: string): Record<string, unknown> {
  switch (name) {
    case 'router_status':
    case 'device_state':
      return {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: []
      };
    case 'presence_history':
    case 'audit_history':
      return {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO timestamp, max 30 days back' },
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        required: ['since']
      };
    case 'evidence_lookup':
      return {
        type: 'object',
        properties: {
          evidenceKind: {
            type: 'string',
            enum: ['telemetry_snapshot', 'presence_event', 'device', 'audit_event']
          },
          evidenceId: { type: 'string', maxLength: 64 }
        },
        required: ['evidenceKind', 'evidenceId']
      };
    default:
      return { type: 'object', properties: {}, required: [] };
  }
}
