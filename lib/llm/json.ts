import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared JSON-mode model caller. Same provider selection + grammar-enforced
 * JSON as lib/suggest and lib/summary, but generalized to take (system, schema,
 * user) so newer callers (lib/recap) don't need a fourth private copy. Returns
 * the raw content string; the caller parses. Keyless-capable (local Ollama /
 * bundled llama.cpp by default; Anthropic/Groq optional).
 *
 * The older modules keep their own inlined provider machinery for a clean
 * revert (code-review finding #5, deferred); this is the forward home for it.
 */

export type LlmProvider = "ollama" | "llamacpp" | "anthropic" | "groq";

export function activeLlmProvider(): LlmProvider {
  const p = (process.env.SUGGEST_PROVIDER ?? "").toLowerCase();
  if (p === "anthropic" || p === "groq" || p === "ollama" || p === "llamacpp") return p;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "ollama";
}

export interface JsonCall {
  system: string;
  /** JSON Schema the model output must match. */
  schema: object;
  user: string;
  maxTokens?: number;
  /** Name for the schema (llama.cpp / providers that want one). */
  schemaName?: string;
}

/** One JSON-mode call via the active provider. Returns raw content (unparsed). */
export async function callJSON(opts: JsonCall): Promise<string> {
  switch (activeLlmProvider()) {
    case "anthropic":
      return viaAnthropic(opts);
    case "groq":
      return viaGroq(opts);
    case "llamacpp":
      return viaLlamaCpp(opts);
    default:
      return viaOllama(opts);
  }
}

/* ---------------- Ollama (local, free, default) ---------------- */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

async function viaOllama({ system, schema, user, maxTokens }: JsonCall): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: schema,
        keep_alive: "30m",
        // Pin the context to match the bundled llama.cpp model (n_ctx 4096) so
        // callers' prompt+output budgeting holds identically in dev and packaged.
        options: { temperature: 0, num_predict: maxTokens ?? 512, num_ctx: 4096 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_URL}. Install and start it (\`brew install ollama && ollama serve\`), then \`ollama pull ${OLLAMA_MODEL}\`.`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 && body.includes("not found")) {
      throw new Error(`Ollama model "${OLLAMA_MODEL}" not found — run \`ollama pull ${OLLAMA_MODEL}\`.`);
    }
    throw new Error(`Ollama request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? "";
}

/* ---------------- llama.cpp (bundled local server) ---------------- */

const LLAMACPP_URL = process.env.LLAMACPP_URL ?? "http://localhost:8080";

async function viaLlamaCpp({ system, schema, user, maxTokens, schemaName }: JsonCall): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${LLAMACPP_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "insight-local",
        temperature: 0,
        max_tokens: maxTokens ?? 512,
        response_format: { type: "json_schema", json_schema: { name: schemaName ?? "out", schema } },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    throw new Error(
      `Could not reach the bundled llama.cpp server at ${LLAMACPP_URL}. It should be started by the app; set LLAMACPP_URL to override.`,
    );
  }
  if (!res.ok) {
    throw new Error(`llama.cpp request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/* ---------------- Anthropic (premium) ---------------- */

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

async function viaAnthropic({ system, schema, user, maxTokens }: JsonCall): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (required by SUGGEST_PROVIDER=anthropic).");
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens ?? 1024,
    system,
    output_config: { format: { type: "json_schema", schema: schema as { [key: string]: unknown } } },
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") return "";
  const text = response.content.find((b) => b.type === "text");
  return text ? text.text : "";
}

/* ---------------- Groq (hosted free tier) ---------------- */

async function viaGroq({ system, schema, user }: JsonCall): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not set (required by SUGGEST_PROVIDER=groq).");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${system}\n\nRespond with a single JSON object matching this schema exactly:\n${JSON.stringify(schema)}`,
        },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}
