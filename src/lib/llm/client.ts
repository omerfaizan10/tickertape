import OpenAI from "openai";
import { z } from "zod";
import type { AgentStepResult, ToolCallRecord } from "../agent/types";

export const CHAT_MODEL = "gpt-4o-mini";

// Per-1K-token pricing for gpt-4o-mini, used to compute cost_usd on every
// step so the eval layer can report real dollar figures instead of vibes.
const PRICE_PER_1K_INPUT = 0.00015;
const PRICE_PER_1K_OUTPUT = 0.0006;

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

function costUsd(tokensIn: number, tokensOut: number): number {
  return (
    (tokensIn / 1000) * PRICE_PER_1K_INPUT +
    (tokensOut / 1000) * PRICE_PER_1K_OUTPUT
  );
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

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      tool_choice: toolDefs.length > 0 ? "auto" : undefined,
    });

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

  messages.push({
    role: "user",
    content:
      "Respond now with only the final structured result matching the required schema. Do not call any more tools.",
  });

  const finalResponse = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: `${params.agentName}_output`,
        schema: z.toJSONSchema(params.outputSchema, { target: "draft-7" }),
        strict: true,
      },
    },
  });

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
