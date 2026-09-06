/**
 * The fal.ai client.
 *
 * Two transports, because fal has two shapes:
 *
 *  - `callTool` hits the OpenRouter passthrough, an OpenAI-compatible chat
 *    endpoint, and forces a tool call so the response shape is guaranteed by
 *    the API rather than regex-parsed out of prose.
 *  - `submitAndPoll` hits the queue API, which every media model uses. It is
 *    submit-then-poll and never blocks, which is not a style preference: a
 *    Convex action is killed at 10 minutes, and a 60-second avatar render can
 *    take longer than that to come back.
 *
 * Auth is fal's own scheme -- `Authorization: Key <token>`, not Bearer.
 */

const LLM_BASE = "https://fal.run/openrouter/router/openai/v1";
const QUEUE_BASE = "https://queue.fal.run";

export const LLM_MODEL = "anthropic/claude-sonnet-4.5";

function key(): string {
  const k = (process.env.FAL_API_KEY ?? "").trim();
  if (!k) {
    throw new Error(
      "FAL_API_KEY is not set on the Convex deployment. " +
        "Run: npx convex env set FAL_API_KEY <your key>",
    );
  }
  return k;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Key ${key()}`, "Content-Type": "application/json" };
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface ToolCallResult {
  /** Parsed tool arguments. */
  value: unknown;
  /** Token counts, so the ledger records what was actually spent. */
  inputTokens: number;
  outputTokens: number;
}

/** One forced-tool-call LLM request. Used by every P1 step. */
export async function callTool(
  system: string,
  userPrompt: string,
  tool: ToolSpec,
): Promise<ToolCallResult> {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: tool.name } },
    }),
  });

  if (!res.ok) {
    throw new Error(`fal LLM call failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { tool_calls?: { function: { arguments: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("model did not return a tool call");

  let value: unknown;
  try {
    value = JSON.parse(call.function.arguments);
  } catch {
    throw new Error("model returned unparseable tool call arguments");
  }

  return {
    value,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

/**
 * Submit to the queue and poll until terminal.
 *
 * Deliberately capped well under the action timeout: a step that hasn't
 * finished in time should hand the request id back so a later step can resume
 * polling, rather than dying inside a workflow that then has to retry the
 * whole generation and pay for it twice.
 */
export async function submitAndPoll(
  model: string,
  input: unknown,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 8 * 60_000;
  const pollMs = opts.pollMs ?? 3_000;

  const submit = await fetch(`${QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!submit.ok) {
    throw new Error(`fal submit failed: ${submit.status} ${await submit.text()}`);
  }

  const { status_url, response_url } = (await submit.json()) as {
    status_url: string;
    response_url: string;
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));

    const statusRes = await fetch(status_url, { headers: authHeaders() });
    if (!statusRes.ok) continue; // transient; keep polling until the deadline

    const { status } = (await statusRes.json()) as { status: string };
    if (status === "COMPLETED") {
      const out = await fetch(response_url, { headers: authHeaders() });
      if (!out.ok) {
        throw new Error(`fal result fetch failed: ${out.status}`);
      }
      return out.json();
    }
    if (status === "FAILED") {
      throw new Error(`fal job failed for ${model}`);
    }
  }

  throw new Error(`fal job for ${model} did not finish within ${timeoutMs}ms`);
}
