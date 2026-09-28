import OpenAI from "openai";
import { z } from "zod";
import type { AgentStepResult, ToolCallRecord } from "../agent/types";

// The model every agent uses, chosen by the model comparison in
// eval/models.md: gpt-6-luna with reasoning off was the most accurate
// (544/545), the cheapest and the fastest of the four tried, so it's the
// default. Overridable to rerun the comparison (CHAT_MODEL=gpt-6-sol).
export const DEFAULT_MODEL = "gpt-6-luna";
export const DEFAULT_REASONING_EFFORT = "none";
export const CHAT_MODEL = process.env.CHAT_MODEL || DEFAULT_MODEL;

// Reasoning models take an effort setting; others ignore it. Unset means
// the model's own default.
export const REASONING_EFFORT = (process.env.REASONING_EFFORT ||
  (CHAT_MODEL === DEFAULT_MODEL ? DEFAULT_REASONING_EFFORT : undefined)) as
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | undefined;

const REASONING_MODELS = /^(o\d|gpt-5|gpt-6)/;

export const DEFAULT_LABEL = `${DEFAULT_MODEL}@${DEFAULT_REASONING_EFFORT}`;

// How a run's model is recorded: the model, plus the effort when one was
// set, so eval runs at different efforts stay distinguishable.
export const MODEL_LABEL = `${CHAT_MODEL}${
  REASONING_MODELS.test(CHAT_MODEL) && REASONING_EFFORT
    ? `@${REASONING_EFFORT}`
    : ""
}`;

// Standard-tier prices per 1M tokens, from developers.openai.com/api/docs
// (pricing page and each model's page), checked 2026-09-28. Used to put a
// real dollar figure on every step. Reasoning tokens are billed as output.
const PRICES_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6-sol": { input: 2.0, output: 10.0 },
  "gpt-6-astra": { input: 10.0, output: 50.0 },
};

function priceFor(model: string): { input: number; output: number } {
  const p = PRICES_PER_1M[model];
  if (!p) {
    throw new Error(
      `No verified price for ${model}. Add it to PRICES_PER_1M from OpenAI's pricing page before running it, so cost figures stay real.`,
    );
  }
  return p;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local (see env.example), or set MOCK_LLM=true to run without it.",
    );
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export function isMockMode(): boolean {
  return process.env.MOCK_LLM === "true";
}

export interface ToolDefinition<A = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  handler: (args: A) => Promise<unknown>;
}

export interface RunAgentStepParams<T> {
  agentName: string;
  systemPrompt: string;
  userPrompt: string;
  outputSchema: z.ZodType<T>;
  // Base64 data URLs. When present, sent alongside userPrompt as vision
  // content parts on the same user message - gpt-4o-mini is multimodal,
  // no separate client or model needed for this.
  images?: string[];
  // Tools carry different arg shapes per instance; a heterogeneous array
  // has to erase that at this boundary, each definition stays typed at its
  // own call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: ToolDefinition<any>[];
  maxToolRounds?: number;
  // Only used when MOCK_LLM=true. Lets each agent supply a deterministic,
  // input-derived response so the pipeline is fully exercisable without an
  // API key, instead of returning placeholder junk.
  mock: () =>
    | { output: T; toolCalls?: ToolCallRecord[] }
    | Promise<{ output: T; toolCalls?: ToolCallRecord[] }>;
}

// Three extractors run in parallel per filing, and a batch eval keeps that
// up for minutes, which saturates the account's tokens-per-minute limit.
// The SDK's own retries back off for seconds; a saturated window needs
// tens of seconds. So a rate-limit error waits for the window to roll over
// before trying again, instead of failing the agent. Any other error is
// real and surfaces immediately.
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WAIT_MS = 15_000;

async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 429 || attempt >= RATE_LIMIT_ATTEMPTS) throw err;
      const jitter = Math.random() * 3000;
      await new Promise((r) =>
        setTimeout(r, RATE_LIMIT_WAIT_MS * attempt + jitter),
      );
    }
  }
}

function costUsd(tokensIn: number, tokensOut: number): number {
  const p = priceFor(CHAT_MODEL);
  return (tokensIn / 1e6) * p.input + (tokensOut / 1e6) * p.output;
}

function modelParams() {
  return REASONING_MODELS.test(CHAT_MODEL) && REASONING_EFFORT
    ? { model: CHAT_MODEL, reasoning_effort: REASONING_EFFORT }
    : { model: CHAT_MODEL };
}

export async function runAgentStep<T>(
  params: RunAgentStepParams<T>,
): Promise<AgentStepResult<T>> {
  const start = Date.now();

  if (isMockMode()) {
    const { output, toolCalls = [] } = await params.mock();
    // A little jitter so batch summaries and trace views don't look faked.
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 45));
    return {
      output,
      toolCalls,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - start,
    };
  }

  const openai = getClient();
  const tools = params.tools ?? [];
  const maxToolRounds = params.maxToolRounds ?? 4;

  const toolDefs = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(t.parameters, { target: "draft-7" }),
    },
  }));

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] | string =
    params.images && params.images.length > 0
      ? [
          { type: "text", text: params.userPrompt },
          ...params.images.map(
            (url): OpenAI.Chat.ChatCompletionContentPart => ({
              type: "image_url",
              image_url: { url },
            }),
          ),
        ]
      : params.userPrompt;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: userContent },
  ];

  const toolCallRecords: ToolCallRecord[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  // Without tools there is nothing to loop over: go straight to the
  // structured answer. (A free-text first call would read the whole
  // statement twice and double the cost for nothing.)
  for (let round = 0; toolDefs.length > 0 && round < maxToolRounds; round++) {
    const response = await withRateLimitRetry(() =>
      openai.chat.completions.create({
        ...modelParams(),
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        tool_choice: toolDefs.length > 0 ? "auto" : undefined,
      }),
    );

    tokensIn += response.usage?.prompt_tokens ?? 0;
    tokensOut += response.usage?.completion_tokens ?? 0;

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      const tool = tools.find((t) => t.name === call.function.name);
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: `unknown tool ${call.function.name}`,
          }),
        });
        continue;
      }
      const args = tool.parameters.parse(JSON.parse(call.function.arguments));
      const result = await tool.handler(args);
      toolCallRecords.push({ name: tool.name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (toolDefs.length > 0) {
    messages.push({
      role: "user",
      content:
        "Respond now with only the final structured result matching the required schema. Do not call any more tools.",
    });
  }

  const finalResponse = await withRateLimitRetry(() =>
    openai.chat.completions.create({
      ...modelParams(),
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: `${params.agentName}_output`,
          schema: z.toJSONSchema(params.outputSchema, { target: "draft-7" }),
          strict: true,
        },
      },
    }),
  );

  tokensIn += finalResponse.usage?.prompt_tokens ?? 0;
  tokensOut += finalResponse.usage?.completion_tokens ?? 0;

  const content = finalResponse.choices[0].message.content ?? "{}";
  const output = params.outputSchema.parse(JSON.parse(content));

  return {
    output,
    toolCalls: toolCallRecords,
    tokensIn,
    tokensOut,
    costUsd: costUsd(tokensIn, tokensOut),
    latencyMs: Date.now() - start,
  };
}
