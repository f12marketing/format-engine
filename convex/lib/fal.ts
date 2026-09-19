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
 *
 * Every request that carries file URLs passes its input through
 * `falReachable` first, which copies anything on a private host to fal's
 * own storage -- see that function for why.
 */

const LLM_BASE = "https://fal.run/openrouter/router/openai/v1";
const QUEUE_BASE = "https://queue.fal.run";
const SYNC_BASE = "https://fal.run";
const STORAGE_INITIATE =
  "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";

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

/**
 * fal fetches every file URL it is given from its own servers, so a URL on a
 * loopback or private-network host can never work -- which is every file a
 * local `npx convex dev` backend serves (`http://127.0.0.1:3210/api/storage/
 * ...`), and was why uploaded images, avatar portraits and stored scenes all
 * failed with fal's "Failed to download the file" 422 in local runs.
 *
 * Such URLs are copied to fal's CDN first and swapped for the copy. A
 * deployed backend's URLs are public, so in production this finds nothing
 * and every request goes out byte-for-byte as before -- no file is ever
 * downloaded and re-uploaded inside an action there.
 */
export async function falReachable<T>(input: T): Promise<T> {
  const found = new Set<string>();
  collectPrivateUrls(input, found);
  if (found.size === 0) return input;

  const copies = new Map<string, string>();
  await Promise.all(
    [...found].map(async (url) => copies.set(url, await copyToFalStorage(url))),
  );
  return swapUrls(input, copies) as T;
}

/** Copies are only needed for the request that uses them. */
const COPY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Remembers copies within one action's lifetime, so a content-policy retry
 * (up to three submissions of the same input) uploads each file once.
 * Entries are dropped well before fal expires the copy.
 */
const recentCopies = new Map<string, { url: string; at: number }>();
const REUSE_COPY_MS = 60 * 60 * 1000;

async function copyToFalStorage(url: string): Promise<string> {
  const cached = recentCopies.get(url);
  if (cached && Date.now() - cached.at < REUSE_COPY_MS) return cached.url;

  const source = await fetch(url);
  if (!source.ok) {
    throw new Error(`could not read ${url} to copy it to fal storage: ${source.status}`);
  }
  const contentType = source.headers.get("content-type") ?? "application/octet-stream";
  const bytes = await source.arrayBuffer();

  const initiate = await fetch(STORAGE_INITIATE, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "X-Fal-Object-Lifecycle": JSON.stringify({ expiration_duration_seconds: COPY_TTL_SECONDS }),
    },
    body: JSON.stringify({ content_type: contentType, file_name: fileNameFor(url, contentType) }),
  });
  if (!initiate.ok) {
    throw new Error(`fal storage upload failed: ${initiate.status} ${await initiate.text()}`);
  }
  const { upload_url, file_url } = (await initiate.json()) as {
    upload_url: string;
    file_url: string;
  };

  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(`fal storage upload failed: ${put.status} ${await put.text()}`);
  }

  recentCopies.set(url, { url: file_url, at: Date.now() });
  return file_url;
}

/**
 * Convex storage URLs have no extension, and some fal models infer a file's
 * format from its name, so the copy gets one from the content type.
 */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "application/zip": "zip",
};

function fileNameFor(url: string, contentType: string): string {
  const base = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "file";
  const ext = EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()];
  return ext && !base.includes(".") ? `${base}.${ext}` : base;
}

function collectPrivateUrls(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (isPrivateUrl(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectPrivateUrls(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectPrivateUrls(v, into);
  }
}

function swapUrls(value: unknown, copies: Map<string, string>): unknown {
  if (typeof value === "string") return copies.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => swapUrls(v, copies));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapUrls(v, copies)]));
  }
  return value;
}

function isPrivateUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10).
    return host === "::1" || /^f[cd]/.test(host) || host.startsWith("fe80:");
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
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

/**
 * One forced-tool-call LLM request. Used by every P1 step.
 *
 * `model` exists for Drama, which runs on the model DramaClaw itself is
 * tuned for rather than the app-wide default -- fal's OpenRouter passthrough
 * serves any OpenRouter model id through the same endpoint and key.
 */
export async function callTool(
  system: string,
  userPrompt: string,
  tool: ToolSpec,
  opts: { model?: string } = {},
): Promise<ToolCallResult> {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: opts.model ?? LLM_MODEL,
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
            ...(await falReachable(imageUrls)).map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
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
 * Submit to the queue with a webhook and return immediately -- no polling at
 * all, not even a capped one. `submitAndPoll`'s cap exists because a normal
 * generation step still finishes within an action's lifetime most of the
 * time; a LoRA training run does not; measured at ~5 minutes for the cheapest
 * 1000-step tier, and Convex kills an action at 10 minutes regardless. fal
 * calls `webhookUrl` on completion (see the influencers.ts webhook receiver
 * for the other half of this).
 */
export async function submitWithWebhook(
  model: string,
  input: unknown,
  webhookUrl: string,
): Promise<{ requestId: string }> {
  const url = new URL(`${QUEUE_BASE}/${model}`);
  url.searchParams.set("fal_webhook", webhookUrl);

  const submit = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(await falReachable(input)),
  });
  if (!submit.ok) {
    throw new Error(`fal submit failed: ${submit.status} ${await submit.text()}`);
  }
  const { request_id } = (await submit.json()) as { request_id: string };
  return { requestId: request_id };
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

  const handle = await submitQueued(model, input);
  const polled = await pollQueued(model, handle, { budgetMs: timeoutMs, pollMs });
  if (polled.state === "done") return polled.result;
  if (polled.state === "policy") {
    throw new FalContentPolicyError(`content checker rejected the request to ${model}`);
  }
  throw new Error(`fal job for ${model} did not finish within ${timeoutMs}ms`);
}

/** Where a submitted queue request can be checked on and collected from. */
export interface QueuedRequest {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

export type QueuedPoll =
  | { state: "done"; result: unknown }
  | { state: "pending" }
  | { state: "policy" };

/**
 * The submit half of `submitAndPoll`, on its own. For a generation that can
 * outlive one action -- a 15-second Seedance clip queued behind others --
 * the caller keeps this handle in a workflow step and polls from later
 * steps, so running out of time means "poll again" rather than "submit
 * again and pay twice".
 */
export async function submitQueued(model: string, input: unknown): Promise<QueuedRequest> {
  const submit = await fetch(`${QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(await falReachable(input)),
  });
  if (!submit.ok) {
    throw new Error(`fal submit failed: ${submit.status} ${await submit.text()}`);
  }
  const { request_id, status_url, response_url } = (await submit.json()) as {
    request_id: string;
    status_url: string;
    response_url: string;
  };
  return { requestId: request_id, statusUrl: status_url, responseUrl: response_url };
}

/**
 * Poll a queued request for up to `budgetMs`. Never throws on a request
 * that is merely slow -- that comes back as "pending" for the caller to
 * poll again later -- and reports a content-checker rejection as "policy"
 * so a fallback ladder can react to it without catching exceptions.
 */
export async function pollQueued(
  model: string,
  handle: Pick<QueuedRequest, "statusUrl" | "responseUrl">,
  opts: { budgetMs: number; pollMs?: number },
): Promise<QueuedPoll> {
  const pollMs = opts.pollMs ?? 3_000;
  const deadline = Date.now() + opts.budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));

    // A dropped connection or DNS blip is as transient as a 5xx: throwing
    // here fails the step, and its retry re-submits -- paying fal twice for
    // a generation that is still running fine.
    let statusRes: Response;
    try {
      statusRes = await fetch(handle.statusUrl, { headers: authHeaders() });
    } catch {
      continue;
    }
    if (!statusRes.ok) continue; // transient; keep polling until the deadline

    const { status } = (await statusRes.json()) as { status: string };
    if (status === "COMPLETED") {
      try {
        return { state: "done", result: await fetchCompletedResult(model, handle.responseUrl) };
      } catch (e) {
        if (e instanceof FalContentPolicyError) return { state: "policy" };
        throw e;
      }
    }
    if (status === "FAILED") {
      throw new Error(`fal job failed for ${model}`);
    }
  }
  return { state: "pending" };
}

async function fetchCompletedResult(model: string, responseUrl: string): Promise<unknown> {
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
    const out = await fetch(responseUrl, { headers: authHeaders() });
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
export async function rewritePromptNeutrally(
  originalPrompt: string,
  opts: { model?: string } = {},
): Promise<string> {
  const system = `You rewrite image-generation prompts that an automated content filter rejected. The scenes are from animated storytelling and are not intended to be graphic. Rewrite the prompt so it describes the SAME scene, composition, characters and mood using calm, non-graphic visual language.
Rules:
- Keep every @imageN reference tag exactly as written, in the same order.
- Keep the art style, framing, lighting and camera notes unchanged.
- Replace depictions of injury, blood, wounds, violence, death, weapons or physical suffering with restrained visual equivalents (posture, expression, symbolism, colour, shadow).
- The checker sometimes flags phrasing rather than content -- if nothing in the prompt is actually graphic, just simplify the wording (shorter sentences, plainer verbs, fewer intensifiers) rather than inventing something to tone down.
- Do not add new characters, objects or narrative.
- Never try to disguise or smuggle prohibited content; if a scene cannot be shown acceptably, describe it symbolically instead.
Reply with ONLY the rewritten prompt text, no preamble or quotes.`;

  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      model: opts.model ?? LLM_MODEL,
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
    body: JSON.stringify(await falReachable(input)),
  });
  if (!res.ok) {
    throw new Error(`fal sync call failed for ${model}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
