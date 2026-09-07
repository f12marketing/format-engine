/**
 * The fal.ai client.
 *
 * Three transports, because fal has three shapes:
 *
 *  - `callTool` hits the OpenRouter passthrough, an OpenAI-compatible chat
 *    endpoint, and forces a tool call so the response shape is guaranteed by
 *    the API rather than regex-parsed out of prose.
 *  - `submitAndPoll` hits the queue API, which most media models use. It is
 *    submit-then-poll and never blocks, which is not a style preference: a
 *    Convex action is killed at 10 minutes, and a 60-second avatar render can
 *    take longer than that to come back.
 *  - `callSync` hits a model's direct (non-queue) endpoint. Only for models
 *    fast enough that fal itself doesn't queue them -- ElevenLabs TTS is the
 *    one in use here, confirmed against the old app's worker, which calls
 *    this exact endpoint with no status_url/response_url at all.
 *
 * Auth is fal's own scheme -- `Authorization: Key <token>`, not Bearer.
 */

const LLM_BASE = "https://fal.run/openrouter/router/openai/v1";
const QUEUE_BASE = "https://queue.fal.run";
const SYNC_BASE = "https://fal.run";

/**
 * Sonnet 5 rather than 4.5: strictly better on both axes, verified against
 * OpenRouter's own pricing endpoint during the model audit -- newer, and
 * $2/$10 per M tokens against 4.5's $3/$15, so every P1 step in the app got
 * cheaper and more capable at once. The per-file LLM_INPUT_PER_1M /
 * LLM_OUTPUT_PER_1M constants were moved with it.
 */
export const LLM_MODEL = "anthropic/claude-sonnet-5";

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
 * One forced-tool-call LLM request that can also look at images -- Character
 * Swap's verification step is the only caller, comparing a frame of the swap
 * output against the character reference image. Kept separate from
 * `callTool` rather than adding an optional images param to it: every other
 * caller sends plain text, and OpenRouter's content-array shape only applies
 * once there is at least one image to attach.
 */
export async function callVisionTool(
  system: string,
  userPrompt: string,
  imageUrls: string[],
  tool: ToolSpec,
): Promise<ToolCallResult> {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
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
    throw new Error(`fal vision LLM call failed: ${res.status} ${await res.text()}`);
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
      let lastStatus = 0;
      let lastText = "";
      // fal can also report COMPLETED slightly before the result is actually
      // fetchable at response_url -- observed directly as a transient 422
      // that then succeeded seconds later when reproduced by hand with the
      // identical payload. A short retry closes that window instead of
      // failing (and re-billing every other item in the same Promise.all)
      // over what is fal's own propagation delay -- but only when the body
      // isn't a content-policy rejection, which is deterministic and won't
      // change on retry.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        const out = await fetch(response_url, { headers: authHeaders() });
        lastText = await out.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(lastText);
        } catch {
          parsed = null;
        }
        if (isContentPolicyBody(parsed ?? lastText)) {
          throw new FalContentPolicyError(`content checker rejected the request to ${model}`);
        }
        if (out.ok) return parsed;
        lastStatus = out.status;
      }
      throw new Error(`fal result fetch failed: ${lastStatus} ${lastText}`);
    }
    if (status === "FAILED") {
      throw new Error(`fal job failed for ${model}`);
    }
  }

  throw new Error(`fal job for ${model} did not finish within ${timeoutMs}ms`);
}

/**
 * Thrown when fal's content checker rejects a request. Distinguished from a
 * generic fetch failure so a caller can run a fallback ladder instead of just
 * failing the whole step -- discovered live, not ported speculatively: the
 * old app's Python worker documented this arriving as a COMPLETED status
 * whose body carries a `detail` array; here the identical shape arrived on a
 * hard 422 instead. Both are checked.
 */
export class FalContentPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FalContentPolicyError";
  }
}

function detailArray(body: unknown): { type?: string }[] | null {
  const detail = (body as { detail?: unknown } | null)?.detail;
  return Array.isArray(detail) ? (detail as { type?: string }[]) : null;
}

/**
 * Also covers `no_media_generated` -- a different `detail[].type` string,
 * reproduced live generating an avatar portrait on an entirely benign
 * prompt ("man in his 30s, short beard, friendly expression, studio
 * background"), immediately followed by success on an identical retry. It
 * is not literally a content-policy rejection, but it is the same shape of
 * problem for a caller: the model declined to produce anything, and the
 * same fallback ladder (retry, then reword, then a minimal prompt) is the
 * right response rather than failing the step outright on what may just be
 * one queue worker's transient miss.
 */
function isContentPolicyBody(body: unknown): boolean {
  const detail = detailArray(body);
  if (detail?.some((d) => d?.type === "content_policy_violation" || d?.type === "no_media_generated"))
    return true;
  const s = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return (
    s.includes("content_policy_violation") ||
    s.includes("flagged by a content checker") ||
    s.includes("no_media_generated")
  );
}

/**
 * One neutral-language chat call, used only to reword a prompt fal's checker
 * rejected. Plain completion, not a forced tool call -- the old app's own
 * version of this used a bare chat completion with temperature 0.2, and there
 * is no structured shape to enforce for a single string of prose.
 */
export async function rewritePromptNeutrally(originalPrompt: string): Promise<string> {
  const system = `You rewrite image-generation prompts that an automated content filter rejected. The scenes are from animated storytelling and are not intended to be graphic. Rewrite the prompt so it describes the SAME scene, composition, characters and mood using calm, non-graphic visual language.
Rules:
- Keep every @imageN reference tag exactly as written, in the same order.
- Keep the art style, framing, lighting and camera notes unchanged.
- Replace depictions of injury, blood, wounds, violence, death or physical suffering with restrained visual equivalents (posture, expression, symbolism, colour, shadow).
- Do not add new characters, objects or narrative.
- Never try to disguise or smuggle prohibited content; if a scene cannot be shown acceptably, describe it symbolically instead.
Reply with ONLY the rewritten prompt text, no preamble or quotes.`;

  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: originalPrompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`prompt rewrite failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const rewritten = body.choices?.[0]?.message?.content?.trim();
  if (!rewritten) throw new Error("prompt rewrite returned no text");
  return rewritten;
}

/**
 * Three rungs, ported from the old app's `_generate_with_policy_fallback`:
 * the original prompt, then an LLM-neutralised rewrite of it, then a minimal
 * prompt supplied by the caller that keeps only the bare essentials (a
 * character's neutral reference pose, a shot's scene title and mood). All
 * three failing is a real, visible error rather than a silent skip -- the
 * old app's own message is kept because it tells you exactly where to look.
 */
export async function submitWithContentPolicyFallback(
  model: string,
  buildInput: (prompt: string) => Record<string, unknown>,
  originalPrompt: string,
  minimalPrompt: () => string,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<unknown> {
  try {
    return await submitAndPoll(model, buildInput(originalPrompt), opts);
  } catch (e) {
    if (!(e instanceof FalContentPolicyError)) throw e;
  }

  try {
    const reworded = await rewritePromptNeutrally(originalPrompt);
    return await submitAndPoll(model, buildInput(reworded), opts);
  } catch (e) {
    if (!(e instanceof FalContentPolicyError)) throw e;
  }

  try {
    return await submitAndPoll(model, buildInput(minimalPrompt()), opts);
  } catch (e) {
    if (e instanceof FalContentPolicyError) {
      throw new Error(
        "content checker rejected this shot on all three prompt variants " +
          "(original, reworded, minimal) -- edit the shot and retry.",
      );
    }
    throw e;
  }
}

/** A model fast enough that fal serves it directly, no queue. */
export async function callSync(model: string, input: unknown): Promise<unknown> {
  const res = await fetch(`${SYNC_BASE}/${model}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`fal sync call failed for ${model}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
