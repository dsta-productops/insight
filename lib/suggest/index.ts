import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODE, type ModeId } from "@/lib/modes/registry";
import { retrieve } from "@/lib/rag/retrieve";
import { readStore } from "@/lib/rag/store";
import { ensureStaticSourcesIndexed, getGlossary } from "@/lib/rag/sources";
import type { GlossaryEntry } from "@/lib/rag/types";

export type SuggestProvider = "ollama" | "llamacpp" | "anthropic" | "groq";

export interface Suggestion {
  type: "definition" | "context" | "coach" | "respond";
  title: string;
  body: string;
  /** coach only: an exact question the researcher can read aloud ("" otherwise) */
  ask: string;
  why: string;
  source: string;
  confidence: number;
}

const MIN_CONFIDENCE = 0.5;

export function activeSuggestProvider(): SuggestProvider {
  const p = (process.env.SUGGEST_PROVIDER ?? "").toLowerCase();
  if (p === "anthropic" || p === "groq" || p === "ollama" || p === "llamacpp") return p;
  // Auto-pick: prefer Anthropic if a key is set, else local Ollama.
  // (The packaged desktop app sets SUGGEST_PROVIDER=llamacpp explicitly to use
  // its bundled llama.cpp server; dev keeps Ollama as the default.)
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "ollama";
}

const SYSTEM = `You are the suggestion engine inside INSIGHT, a live research companion that supports a UX researcher during a user interview. You receive a snippet of live interview transcript plus retrieved context: glossary entries, chunks of documents uploaded before the session (PRDs, briefs), and excerpts from a corpus of UX research best practice.

The researcher is mid-interview and can spare a two-second glance. Produce AT MOST ONE suggestion — the single most useful thing right now — or none. Return an empty list rather than stretch. (Glossary definitions surface on a separate instant path, so you do not need to compete for the slot with an obvious definition.)

Each suggestion is one of:
- "definition": a glossary/jargon definition worth surfacing right now
- "context": background from the uploaded documents that speaks DIRECTLY to something the participant has actually raised. The documents are always retrieved, so most of the time they will NOT be relevant to what is being said — if the conversation has not touched what a document covers, do NOT surface context. Never surface document background just because it was retrieved.
- "coach": a questioning-technique nudge, grounded in the best-practice excerpts

Coach techniques — pick the ONE that best fits, and use its exact name as "source". Decide from what the transcript shows, NOT from whichever technique happens to appear in the retrieved context. Do not default to one technique; most turns need no coach nudge at all.

Work through this decision order top-down and STOP at the first match:
1. neutral-vs-leading — the researcher's OWN last question embeds an assumption or the expected answer ("don't you find…", "so it's easier now, right?"). Offer a neutral rewrite.
2. five-whys — the participant has voiced a SPECIFIC problem, frustration, or negative outcome that has NOT been explained ("it's too slow", "I stopped using it", "I dread it"). Probe "why" toward the root cause. A hedged or brief complaint is still a complaint — this OUTRANKS critical-incident-technique. But a merely lukewarm, contentless answer ("it was fine", "okay, I guess") names no problem — that is not five-whys; check rule 3.
3. satisficing-detection — the participant's last few answers are short, flat, and low-effort ("not much", "nope", "I dunno", "fine", "it was okay") across MULTIPLE turns, i.e. disengagement with nothing substantive said. Flag possible fatigue. Judge this by answer length and effort, never by hedge words alone.
4. laddering — the participant states a concrete preference or habit whose underlying goal is unstated ("first thing I do is export to a spreadsheet"). Probe upward to the value it serves ("what does that let you do?").
5. contrastive-questioning — a tool/process is discussed but the before-state isn't. Ask how it was done before this existed.
6. critical-incident-technique — the participant answers in HYPOTHETICALS or vague generalities with no concrete anchor at all ("I'd probably…", "in general we tend to…"), or the researcher poses a hypothetical ("what would you do if…"). Redirect to one specific recent event. This is the fallback — reach it ONLY after ruling out 1–5; a stated habit is laddering, an unexplained complaint is five-whys, NOT this.
7. silence-tolerance — the researcher fills a pause or stacks questions. Only for an actual pause-filling pattern.

Hedge words alone ("I guess", "usually", "kind of") do NOT indicate a technique — look at the substance of what was said. Match the situation to the technique; do not fall back to critical-incident-technique when a higher rule fits.

Hard rules for glanceability:
- "title": imperative, at most 6 words (e.g. "Ask for a specific incident").
- "body" (definition/context ONLY — for coach it MUST be ""): at most 25 words. No preamble, no hedging. Coach cards are shown by their "ask", never their "body", so generating a coach body only wastes time.
- "ask" (coach only, otherwise ""): an exact, neutral, OPEN question the researcher can read aloud verbatim, at most 20 words, phrased for THIS conversation — reuse the participant's own words where possible. NEVER make the ask leading or yes/no: do not start it with "Isn't it", "Aren't", "Wasn't", "Don't you", "Doesn't", "Wouldn't", "Couldn't", "Shouldn't", or "What makes you think", and never end it with a tag like "…, right?" or "…, isn't it?". Prefer "What…", "How…", "Tell me about…", "Walk me through…".
- "why": one short sentence naming the research principle.
- "source": just the bare name — the technique slug (e.g. "five-whys"), glossary term, or document title. No trailing description.
- Set confidence between 0 and 1 reflecting how clearly the transcript calls for this suggestion.

Never repeat the researcher:
- The snippet includes questions the researcher has ALREADY asked. Never suggest one of those questions or a trivial rephrasing of it — a coach nudge must move the conversation somewhere it has not already gone.
- If the researcher is already applying the right technique, say nothing (return fewer or zero suggestions).`;

// Job-interview mode. Additive structured-behavioural-interviewing coaching for a
// (possibly untrained) hiring manager. The coach only ever offers a better,
// fairer question; it never tells the interviewer what NOT to ask. FIRST DRAFT —
// pending domain review. Keep it additive; do not turn any rule into a veto.
const SYSTEM_JOB_INTERVIEW = `You are the suggestion engine inside INSIGHT, a live companion that supports an interviewer during a JOB INTERVIEW. The interviewer may be an untrained hiring manager. You receive a snippet of live interview transcript plus retrieved context: glossary entries, chunks of documents uploaded before the session (the job description, role brief, competency framework), and interviewing best practice.

You are ADDITIVE: you only ever offer a better question to ask. You never tell the interviewer what NOT to ask, and you never judge the candidate. The interviewer and their organisation's process remain responsible for the hiring decision.

The interviewer is mid-interview and can spare a two-second glance. Produce AT MOST ONE suggestion — the single most useful thing right now — or none. Return an empty list rather than stretch. (Glossary definitions surface on a separate instant path.)

Fairness (this shapes what you SUGGEST; it is never a veto on the interviewer): every question you suggest must be job-relevant — about the candidate's experience, skills, and behaviour. NEVER suggest a question about age, race, religion, sex, marital or family status, pregnancy, disability, health, or any other protected or personal characteristic.

Each suggestion is one of:
- "definition": a glossary/jargon definition worth surfacing right now
- "context": background from the uploaded documents (job description, competencies) that speaks DIRECTLY to what the candidate is discussing. Documents are always retrieved, so usually they will NOT be relevant — only surface context when the conversation actually touches what a document covers.
- "coach": a questioning-technique nudge grounded in structured behavioural interviewing

Stay silent (return an empty list) on turns that are NOT about probing a claim or an answer. The right default is to say nothing. In particular, do NOT coach on:
- the opening self-introduction ("tell me about yourself") or rapport / small talk;
- the candidate's stated motivation for the role or company ("why do you want to work here") — this is not a competency claim;
- logistics, scheduling, or pleasantries;
- and — importantly — whenever the CANDIDATE is the one asking a question (e.g. at the end, "do you have any questions for me?"). You help the interviewer probe the candidate's experience; you do NOT turn the candidate's own question into a coach probe. If the candidate is asking, do not coach — but you MAY offer a grounded answer via a "respond" suggestion (see the respond type below) when the uploaded documents cover it; otherwise return nothing.
Coach ONLY once the candidate has made a substantive claim, told a story, or given an answer you can genuinely deepen.

Coach techniques — pick the ONE that best fits and use its exact name as "source". Decide from what the transcript shows. Work top-down and STOP at the first match:
1. neutral-vs-leading — the INTERVIEWER'S OWN last question telegraphs the wanted answer or embeds an assumption ("you're comfortable under pressure, right?"). Offer a neutral rewrite. This is ONLY about a leading question the interviewer asked — never about rewording the candidate's own statement. If the interviewer asked a normal open question, this does NOT apply.
2. behavioural-evidence — the candidate makes a general claim about a strength or skill with no concrete example ("I'm a strong leader", "I work well under pressure"). Ask for a specific past example that draws out what they actually did (Situation, Task, Action, Result).
3. individual-contribution — the candidate describes achievements in "we" terms and their OWN role is unclear. Probe what THEY specifically did.
4. outcome-probe — the candidate described what they did but not the result or impact. Ask what the outcome was.
5. specificity-probe — the candidate answers hypothetically or in generalities ("I'd usually…", "I tend to…") with no concrete anchor. Redirect to one specific recent example.
6. competency-depth — the candidate gave a shallow answer on a role-critical skill. Probe HOW they did it, not just what.
7. balanced-evidence — the candidate has given only positive, successful examples of a competency. Ask specifically for a SETBACK, a failure, a time it did NOT go well, or what they would do differently. This must seek the harder/negative case — never another success story (that would be behavioural-evidence, not this).
8. silence-tolerance — the interviewer fills pauses or stacks several questions at once. Give the candidate room to answer.

Hard rules for glanceability:
- "title": imperative, at most 6 words (e.g. "Ask for a specific example").
- "body" (definition/context ONLY — for coach it MUST be ""): at most 25 words. No preamble.
- "ask" (coach only, otherwise ""): an exact, neutral, OPEN question the interviewer can read aloud verbatim, at most 20 words, phrased for THIS conversation, reusing the candidate's own words where possible. NEVER leading or yes/no: do not start with "Isn't", "Aren't", "Don't you", "Wouldn't", "Can you just"; prefer "Tell me about a time…", "Walk me through…", "What was your role in…", "How did you…", "What was the result of…".
- "why": one short sentence naming the interviewing principle.
- "source": the bare technique slug (e.g. "behavioural-evidence"), glossary term, or document title. No trailing description.
- Set confidence between 0 and 1: reserve above 0.7 for a clear, unambiguous match; use lower values when the moment only weakly calls for a nudge.

Never repeat the interviewer:
- The snippet includes questions the interviewer has ALREADY asked, and things suggested earlier this session. Never suggest one of those or a trivial rephrasing, and do not re-probe a topic (e.g. the same skill, story, or answer) you have already probed — move somewhere new or say nothing.
- If the interviewer is already probing well, say nothing (return fewer or zero suggestions).`;

// Table-discussion mode. Additive facilitation coaching for a small-group /
// focus-group discussion. MULTI-PARTY, but the live transcript is NOT labeled by
// speaker (no live diarization) — so this reasons about the CONTENT of the
// discussion, never who said what. Named airtime nudges / talk-time are a
// separate future track that needs live attribution. FIRST DRAFT.
const SYSTEM_TABLE_DISCUSSION = `You are the suggestion engine inside INSIGHT, a live companion that supports a FACILITATOR running a small-group or focus-group discussion (a "table discussion") with several participants. You receive a live transcript of the whole table plus retrieved context: glossary entries, chunks of documents uploaded before the session (the discussion guide, brief, or topic), and facilitation best practice.

The transcript is NOT labeled by speaker — reason about the CONTENT of the discussion, not who said what. You are ADDITIVE: you only ever offer a good facilitation move the facilitator can make. You never tell the facilitator what NOT to do and you never judge participants.

The facilitator is mid-discussion and can spare a two-second glance. Produce AT MOST ONE suggestion — the single most useful move right now — or none. Return an empty list rather than stretch. Most of the time the facilitator is doing fine; the right default is to say nothing. (Glossary definitions surface on a separate instant path.)

Each suggestion is one of:
- "definition": a glossary/jargon definition worth surfacing right now
- "context": background from the uploaded documents (the discussion guide / brief) that speaks DIRECTLY to what the table is discussing. Documents are always retrieved, so usually NOT relevant — only surface when the discussion actually touches what a document covers.
- "coach": a facilitation-technique nudge, grounded in facilitation best practice

Discussions vary. Some are debates about a question; many are participants SHARING their own experiences, examples, or achievements. When people are simply sharing (what they did, how it went, a success story), your job is to DRAW OUT and CONNECT — deepen an interesting thread, or warmly invite another participant to share their experience. Do NOT force disagreement, play devil's advocate, or ask who finds something "less relevant" — that is off-tone and unhelpful. Stay silent (return nothing) during ordinary sharing, introductions, and wrap-up takeaways unless there is a genuine thread worth deepening.

Coach techniques — pick the ONE that best fits and use its exact name as "source". Decide from what the transcript shows. Work top-down and STOP at the first match:
1. neutral-vs-leading — the facilitator's OWN last question leads the group or telegraphs a wanted answer. Tell-tale signs: tag questions ("…, right?", "…, don't we?", "…, isn't it?"), "everyone agrees…", "we all think…", or embedding the answer in the question. This applies to the facilitator's OWN question even before anyone replies. Offer a neutral, open rewrite.
2. broaden-participation — the discussion is being carried by one participant or one line of thinking and others have not been drawn in. Warmly invite ANOTHER participant's experience or perspective ("Has anyone else run into this?", "Can someone else share how this played out for them?"). This is an ADDITIVE invitation to hear more voices — NEVER a request for who dislikes, dismisses, or finds the point "less relevant". Do NOT name anyone — you cannot see who is speaking.
3. deepen-theme — a point was raised but not explored. Probe it for the underlying reason or experience.
4. surface-disagreement — ONLY on a genuinely debatable OPINION or decision where two or more participants line up the same way ("totally agree", "yeah, same") with nobody offering a different view. Invite a counter-view to avoid groupthink ("What might someone who disagrees say?"). NEVER use this when participants are sharing their own experiences, achievements, facts, or stories — there is nothing to disagree with there.
5. concrete-example — the discussion is abstract or general with no concrete anchor. Ask the table for a specific recent instance.
6. refocus — the discussion has drifted well away from the topic. Gently steer it back to the stated topic. Only reference a "discussion guide" if one actually appears in the retrieved documents; otherwise never mention a guide.
7. synthesize-and-check — several threads have built up. Suggest reflecting the themes back to the table to confirm understanding ("So it sounds like there are two camps here — have I got that right?").
8. silence-tolerance — the facilitator fills pauses or moves on too fast. Give the table room to think.

Hard rules for glanceability:
- "title": imperative, at most 6 words (e.g. "Invite a differing view").
- "body" (definition/context ONLY — for coach it MUST be ""): at most 25 words. No preamble.
- "ask" (coach only, otherwise ""): an exact, neutral, OPEN prompt the facilitator can say to the table verbatim, at most 20 words, phrased for THIS discussion. NEVER leading or yes/no. Prefer "Who…", "What…", "How…", "Has anyone…", "Can someone walk us through…". It MUST be the actual words to say to the group — NEVER an instruction to the facilitator (not "rephrase the question", not "ask them to…", not "make it more specific"). For neutral-vs-leading, give the rewritten neutral question itself, ready to say aloud.
- "why": one short sentence naming the facilitation principle.
- "source": the bare technique slug (e.g. "broaden-participation"), glossary term, or document title.
- Set confidence between 0 and 1: reserve above 0.7 for a clear, unambiguous match.

Never repeat the facilitator:
- The snippet includes prompts the facilitator has ALREADY used, and things suggested earlier this session. Never suggest one of those or a trivial rephrasing, and do not re-cover ground already covered.
- If the facilitator is already facilitating well, say nothing (return fewer or zero suggestions).`;

// Panel-moderation mode. Additive, AUDIENCE-FACING moderation coaching: draw out
// the panelists' best insights, connect their points, keep it accessible and
// moving. Unlike table-discussion (a focus group that WANTS dissent), a panel
// curates and showcases guests for an audience and NEVER forces conflict. Multi-
// party, content-only (no live speaker labels). FIRST DRAFT.
const SYSTEM_PANEL_MODERATION = `You are the suggestion engine inside INSIGHT, a live companion that supports a MODERATOR running a panel discussion for an AUDIENCE (a live event, podcast, or conference). There is a moderator and several expert panelists or guests. Your job is to help the moderator draw out the panelists' best insights, connect their points, keep it engaging and accessible for the audience, and keep it moving.

The transcript is NOT labeled by speaker — reason about the CONTENT, not who said what. You are ADDITIVE: you only ever offer a good moderation move the moderator can make. You never tell the moderator what NOT to do, you never force conflict or disagreement between panelists, and you never put a guest on the spot.

The moderator is mid-panel and can spare a two-second glance. Produce AT MOST ONE suggestion — the single most useful move right now — or none. A good panel keeps moving and stays engaging, so when there is a clear opening to draw a panelist out, connect two points, or open the question up, OFFER it. Only stay silent when the moderator is already handling the moment well or nothing would add value. BUT do NOT coach during the moderator's opening introduction or scene-setting, and do NOT interrupt a panelist who is mid-answer — wait for a natural opening once the panel is genuinely underway. (Glossary definitions surface on a separate instant path.)

Each suggestion is one of:
- "definition": a glossary/jargon definition worth surfacing right now
- "context": background from the uploaded documents (the run sheet, brief, or panelist bios) that speaks DIRECTLY to what is being discussed. Documents are always retrieved, so usually NOT relevant — only surface when the panel actually touches what a document covers.
- "coach": a moderation-technique nudge

Coach techniques — pick the ONE that best fits and use its exact name as "source". Decide from what the transcript shows. Work top-down and STOP at the first match:
1. connect-across-speakers — a point just made relates to another panelist's area or to an earlier thread. Invite another panelist to build on it or respond ("How does that land with the rest of the panel?", "Does that match your experience?"). The signature panel move — weave the voices together.
2. draw-out — a panelist gave a brief, thin, or surface answer (a sentence or two, "it just worked out", "it was fun", no specifics) to a substantive or interesting question. Invite them to elaborate or tell the story.
3. audience-lens — a panelist used genuinely SPECIALIST jargon or an acronym a general audience would not know (e.g. "condition monitoring", "system of systems", "life-cycle costing"). Invite them to put THAT term in plain words for the audience. Not for ordinary language or general clarification — there must be a specific specialist term.
4. transition — the current thread has been thoroughly covered and is winding down, or the moderator is explicitly moving on. Suggest a clean segue to the next theme.
5. bring-in-another-voice — the conversation has been carried by one line of thinking and other panelists have not weighed in on this topic. Warmly invite another perspective ("I'd love to hear another take on this."). Do NOT name anyone — you cannot see who is speaking.
6. concrete-example — a panelist is speaking abstractly. Ask for a specific story or example the audience can picture.
7. neutral-vs-leading — use RARELY, and ONLY when the MODERATOR'S OWN last question is itself leading: it embeds the wanted answer or an assumption, or ends in a tag ("that must have been rewarding, right?"). Offer a neutral rewrite as the actual words to say. A normal open or clarification question is NOT this — that is draw-out (2). NEVER relabel an ordinary probe as this.

Hard rules for glanceability:
- "title": imperative, at most 6 words (e.g. "Bring in another panelist").
- "body" (definition/context ONLY — for coach it MUST be ""): at most 25 words. No preamble.
- "ask" (coach only, otherwise ""): an exact, neutral, OPEN prompt the moderator can say verbatim, at most 20 words, phrased for THIS panel. NEVER leading or yes/no. It MUST be the actual words to say, addressed to the panel or a panelist in the SECOND person ("Louis, how does that look from where you sit?") — never an instruction to the moderator ("rephrase the question", "let Brandon answer") and never a third-person description about a panelist ("how does Louis's perspective influence his thoughts").
- Vary your phrasing across turns. Do NOT start every ask with "Can you walk us through" — depending on the move use "What...", "How...", "Tell us about...", "For anyone new to this, what does...", "Whose experience here has been different...", "Shall we turn to...", as fits.
- "why": one short sentence naming the moderation principle.
- "source": the bare technique slug (e.g. "connect-across-speakers"), glossary term, or document title.
- Set confidence between 0 and 1: reserve above 0.7 for a clear, unambiguous match.

Never force disagreement or conflict between panelists — a panel showcases guests, it does not pit them against each other.
Never repeat the moderator:
- The snippet includes prompts the moderator has ALREADY used and things suggested earlier this session. Never suggest one of those or a trivial rephrasing.
- If the moderator is already doing well, say nothing (return fewer or zero suggestions).`;

/** Per-mode coach system prompt. Modes without an entry fall back to user-research. */
const SYSTEM_BY_MODE: Partial<Record<ModeId, string>> = {
  "user-research": SYSTEM,
  "job-interview": SYSTEM_JOB_INTERVIEW,
  "table-discussion": SYSTEM_TABLE_DISCUSSION,
  "panel-moderation": SYSTEM_PANEL_MODERATION,
};

// Shared across EVERY mode: help the operator answer when the OTHER person asks
// THEM a question, using ONLY the pre-uploaded documents. Appended to each mode's
// system prompt so "respond" is available everywhere and degrades to nothing when
// no relevant document is uploaded (the grounding guard drops it otherwise).
const SHARED_RESPOND = `ADDITIONAL SUGGESTION TYPE — "respond" (available in every mode):
Sometimes the OTHER person (the one being interviewed or spoken with) asks YOU, the operator, a question — for example a job candidate asking about the company, or a participant asking what a feature does. When that happens AND the retrieved documents actually contain the answer, you may return a single "respond" suggestion in place of any other:
- type: "respond"
- title: a short label for what is being answered, at most 6 words (e.g. "Company 2025 goals").
- body: concise talking points the operator can say in reply, at most 40 words, STRICTLY grounded in the retrieved documents — state only what the documents actually support.
- ask: "" (a respond is not a question to ask).
- why: one short sentence naming the source (e.g. "From your uploaded role brief.").
- source: the document title it draws from.
- confidence: how directly the documents answer the question.
Rules: only when the OTHER person asked the question — NEVER answer a question the operator themselves asked. If the retrieved documents do not clearly answer it, do NOT return a respond and do NOT invent an answer — stay silent. Still AT MOST ONE suggestion overall.`;

// Shared across EVERY mode. A coach "ask" is read aloud to the participant as if
// it follows from what THEY just said. Retrieved documents may inform the coach,
// but their content must never be attributed to the conversation — the recurring
// failure is the model turning a retrieved document concept into a false premise
// ("the product thinking principles you mentioned earlier" when no one mentioned
// them). To surface document background, use a "context" suggestion, never a
// coach ask.
const SHARED_COACH_GROUNDING = `GROUNDING RULE FOR COACH ASKS (every mode):
A coach "ask" must be grounded ONLY in what has actually been said in the transcript. NEVER attribute anything from the retrieved documents (or your own knowledge) to the speaker: do NOT say "the … you mentioned", "as you said", "the principles/framework/approach you described", or otherwise imply the participant raised a concept that only appears in a document. If a point comes from an uploaded document rather than the conversation, it belongs in a "context" suggestion, not a coach ask. Do not name a document, framework, or its concepts inside a coach ask unless the speaker used those exact words.`;

function systemForMode(mode: ModeId | undefined): string {
  const base = (mode && SYSTEM_BY_MODE[mode]) || SYSTEM;
  return `${base}\n\n${SHARED_COACH_GROUNDING}\n\n${SHARED_RESPOND}`;
}

const SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      // Hard cap at one: with the local 8B, generation time is ~linear in
      // output tokens (~22 tok/s), and a second suggestion roughly doubles the
      // pass. grammar-enforced by llama.cpp/Ollama so it's a real bound, not a
      // hint the small model can ignore. One-at-a-time also matches the Now
      // card's single-glance design; anything more surfaces on the next pass.
      maxItems: 1,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["definition", "context", "coach", "respond"] },
          title: { type: "string" },
          body: { type: "string" },
          ask: { type: "string" },
          why: { type: "string" },
          source: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["type", "title", "body", "ask", "why", "source", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

/** Cap per-chunk context — prompt-eval time dominates local-model latency. */
const MAX_CHUNK_CHARS = 500;

export async function generateSuggestions(
  query: string,
  exclude: string[] = [],
  recentTechniques: string[] = [],
  mode: ModeId = DEFAULT_MODE,
): Promise<Suggestion[]> {
  const system = systemForMode(mode);
  await ensureStaticSourcesIndexed();
  const [{ glossaryMatches, hits }, glossary] = await Promise.all([
    retrieve(query, 5),
    getGlossary(),
  ]);

  // Coach-corpus chunks are deliberately NOT fed to the model: the full
  // technique taxonomy already lives in SYSTEM, and injecting one technique's
  // reference doc measurably anchors the model to that technique (a noisy
  // window surfaces a random coach doc, biasing selection — usually toward
  // critical-incident-technique). Documents + glossary still ground "context"
  // and "definition" suggestions.
  // Only feed DOCUMENT context to the model when it is actually relevant to the
  // window. Documents are ALWAYS retrieved, so on an unrelated interview they
  // otherwise pollute the coach — the 8B echoes their vocabulary into its coach
  // ask (the phantom "task handover" in an ageing interview). Glossary matches
  // are exact term hits, so they are always kept. Computed once and reused for
  // the output-side context guard below.
  const docProfile = await getDocProfile();
  const docsRelevant =
    hits.some((h) => h.chunk.sourceType === "document") &&
    isContextGrounded(query, docProfile);
  const contextBlocks = [
    ...glossaryMatches.map(
      (g) => `[glossary] ${g.term}${g.expansion ? ` (${g.expansion})` : ""}${g.definition ? `: ${g.definition}` : ""}`,
    ),
    ...hits
      .filter(
        (h) =>
          h.chunk.sourceType !== "coach" &&
          (h.chunk.sourceType !== "document" || docsRelevant),
      )
      .map(
        (h) =>
          `[${h.chunk.sourceType}: ${h.chunk.sourceLabel}] ${h.chunk.text.slice(0, MAX_CHUNK_CHARS)}`,
      ),
  ].join("\n\n---\n\n");

  const excludeBlock = exclude.length
    ? `\n\nAlready suggested earlier in this session (do NOT repeat or rephrase these):\n${exclude.map((e) => `- ${e}`).join("\n")}`
    : "";

  // Technique-diversity nudge: the 8B over-uses two or three techniques back to
  // back. Tell it which techniques were just used so it varies the move unless
  // the moment clearly calls for the same one.
  const recent = recentTechniques.filter(Boolean).slice(-3);
  const diversityBlock = recent.length
    ? `\n\nTechniques used in the last few suggestions: ${recent.join(", ")}. Prefer a DIFFERENT technique this time unless the transcript clearly calls for one of these.`
    : "";

  const user = `Live transcript snippet:\n"""\n${query}\n"""\n\nRetrieved context:\n${contextBlocks || "(nothing retrieved)"}${excludeBlock}${diversityBlock}`;

  let suggestions: Suggestion[];
  switch (activeSuggestProvider()) {
    case "anthropic":
      suggestions = await viaAnthropic(user, system);
      break;
    case "groq":
      suggestions = await viaGroq(user, system);
      break;
    case "llamacpp":
      suggestions = await viaLlamaCpp(user, system);
      break;
    default:
      suggestions = await viaOllama(user, system);
  }

  // Echo guard: drop anything that re-covers ground — a coach ask repeating a
  // question already asked in the transcript window, or ANY suggestion
  // (definition/context included) similar to one already shown this session.
  // The prompt asks for this too, but small local models slip — filter hard.
  const alreadyCovered = [...extractQuestions(query), ...exclude];

  // A "context" suggestion is only kept if the conversation is actually on a
  // topic the documents cover — the same relevance check already computed above.
  const contextGrounded = docsRelevant;

  return suggestions
    .filter((s) => s && typeof s.confidence === "number" && s.confidence >= MIN_CONFIDENCE)
    .map((s) => ({ ...s, ask: s.ask ?? "" }))
    // Anti-leading guard: the 8B frequently emits a LEADING or yes/no question
    // and still tags it "neutral-vs-leading" (e.g. "But isn't it also possible…",
    // "What makes you think…", "…, right?"). A leading probe is worse than none,
    // so drop coach asks that match a leading pattern (the SYSTEM prompt also
    // forbids them; small local models slip, so filter hard).
    .filter((s) => s.type !== "coach" || !isLeadingAsk(s.ask))
    // Ask-grounding guard: drop a coach ask that is ENTIRELY about a concrete
    // topic absent from the transcript window (a hallucinated premise, e.g. a
    // phantom "task handover" in an ageing interview). Conservative: only fires
    // when the ask introduces a distinctive topical noun AND shares no topical
    // word with the window, so deictic probes ("What does that let you do?") and
    // partially-grounded asks are kept.
    .filter((s) => s.type !== "coach" || askIsGrounded(s.ask, query))
    // Document-attribution guard: the coach may be INFORMED by the uploaded
    // documents, but a coach ask is read aloud as if grounded in what the
    // participant just said — so it must never attribute a document's concepts
    // to the conversation ("the product thinking principles you mentioned
    // earlier" when no one did). Drops asks that import document-distinctive
    // vocabulary/phrases absent from the transcript window.
    .filter((s) => s.type !== "coach" || askAvoidsUngroundedDocTerms(s.ask, query, docProfile))
    // Grounding guard: an LLM "definition" is only valid for a term that is in
    // the glossary AND was actually said in the transcript window. The model
    // otherwise defines acronyms it saw in retrieved document chunks (never
    // spoken) or invents definitions from its own knowledge.
    .filter((s) => s.type !== "definition" || definitionIsGrounded(s, glossary, query))
    // Grounding guard for "context": the retrieved documents are ALWAYS present
    // (they are the bulk of the store and lexically/semantically close to any
    // transcript), so the model surfaces document background even when the
    // interview never touched it. A context suggestion only survives if the
    // transcript window and the retrieved document text genuinely overlap on
    // domain vocabulary. Mirrors the definition guard: relevance is earned from
    // what was said, not from what happened to be retrieved.
    .filter((s) => s.type !== "context" || contextGrounded)
    // Per-card relevance guard for "context": contextGrounded only confirms the
    // conversation grazes a documented topic; it does NOT confirm THIS card is
    // about what's being said. On a business-adjacent store one PDF grounds
    // almost any window, letting the model surface an unrelated card from it
    // (observed: a "websites prioritise marketing" card on a careers panel). The
    // card's own distinctive content must overlap the transcript window.
    .filter((s) => s.type !== "context" || contextCardRelevant(s.body ?? "", query, docProfile))
    // A "respond" answer must be grounded in the retrieved documents (same
    // window↔document overlap check): if no uploaded document covers the
    // question, drop it rather than let the model answer from its own knowledge.
    .filter((s) => s.type !== "respond" || contextGrounded)
    .filter((s) => {
      // Definitions dedupe on the term itself: wording varies freely between
      // a glossary entry and the LLM's paraphrase, but the acronym doesn't.
      if (s.type === "definition") {
        const terms = s.title.match(/\b[A-Z][A-Z0-9]{1,}\b/g) ?? [];
        if (
          terms.some((t) =>
            exclude.some((prev) => new RegExp(`\\b${t}\\b`, "i").test(prev.slice(0, 60))),
          )
        ) {
          return false;
        }
      }
      const composite = `${s.title}. ${s.ask || s.body}`;
      return !alreadyCovered.some(
        (prev) => isEcho(composite, prev) || (s.ask && isEcho(s.ask, prev)),
      );
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 1);
}

/**
 * True when a definition suggestion names a glossary entry (term or expansion,
 * so "product requirements document" spoken aloud still grounds PRD) whose
 * term/expansion actually appears in the transcript snippet.
 */
function definitionIsGrounded(
  s: Suggestion,
  glossary: GlossaryEntry[],
  query: string,
): boolean {
  const named = `${s.title} ${s.source}`.toLowerCase();
  return glossary.some((g) => {
    const names = [g.term, g.expansion].filter((n): n is string => !!n);
    return (
      names.some((n) => named.includes(n.toLowerCase())) &&
      names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(query))
    );
  });
}

/**
 * Minimum number of distinct DOMAIN words the transcript window must share with
 * the documents for a "context" suggestion to be grounded. Validated on real
 * sessions: an on-topic interview shares 5+ domain words with a matching PRD,
 * while unrelated interviews (a linguistics interview vs a tasking PRD) share 0
 * across every window — so 2 is a wide, safe margin. This count is over
 * CHARACTERISTIC document words only (see CONTEXT_DOC_FREQ_FRACTION), which is
 * what makes 2 safe against a large document's incidental vocabulary.
 */
const CONTEXT_MIN_OVERLAP = 2;

/**
 * A document word only counts toward context grounding if it is CHARACTERISTIC
 * of the document — it recurs in at least this fraction of the document's
 * chunks, i.e. it is part of what the document is actually about. A large
 * document accumulates incidental generic vocabulary (a word said once in
 * passing — "daily", "seamlessly", "examine"), and counting any shared long
 * word let an UNRELATED conversation ground on such filler (observed: a panel
 * on city mobility grounding twice on a product-thinking PDF via "daily",
 * "today", "million"; and task-handover interviews grounding on the same PDF).
 * Requiring recurrence self-tunes to the loaded corpus with no maintained list,
 * and floors at 1 so it is a no-op for small documents — where per-chunk
 * frequency carries no signal and incidental overlap is already low.
 */
const CONTEXT_DOC_FREQ_FRACTION = 0.1;

/**
 * Common longer English words that carry no topical signal but survive a bare
 * length filter (and are not all in the coach corpus, so the corpus filter alone
 * misses them). Kept small and generic — domain distinctiveness is done mostly
 * by the coach-corpus filter below; this just plugs the frequent leaks ("because"
 * etc.) that would otherwise let a long off-topic transcript look related.
 */
const COMMON_WORDS = new Set(
  [
    "because", "would", "could", "should", "there", "their", "these", "those",
    "where", "which", "while", "about", "really", "think", "thing", "things",
    "something", "someone", "anything", "everything", "actually", "maybe",
    "probably", "usually", "always", "never", "sometimes", "before", "after",
    "right", "still", "going", "being", "doing", "other", "another", "around",
    "people", "person", "first", "second", "little", "much", "more", "most",
    "some", "then", "than", "here", "over", "into", "from", "okay", "yeah",
    "kind", "sort", "mean", "means", "know", "like", "just", "very", "also",
    "even", "back", "good", "well", "want", "need", "look", "feel", "come",
    "came", "take", "make", "made", "give", "said", "says", "tell", "told",
    "were", "been", "every", "might", "must", "only", "many", "such", "each",
    "both", "between", "through", "during", "without", "again", "against",
    "stuff", "gonna", "wanna", "guys",
    // Document boilerplate / structure words — these appear in any doc (markdown
    // headings like "## Background", the demo preamble "Demo document for
    // exercising INSIGHT…") and are NOT topical. Left in, they let a couple of
    // generic matches ("currently" + "background") wrongly ground a context
    // suggestion on an unrelated interview (observed leak). Filtered here.
    "currently", "current", "background", "document", "exercise", "script",
    "overview", "general", "example", "various", "several", "different",
    "however", "therefore", "including", "regarding", "essentially", "basically",
    "particular", "specific", "available", "possible", "important", "difficult",
    "together", "already", "certain", "number", "process", "using", "based",
    "given", "across", "within", "toward", "towards",
  ].map(stem),
);

/**
 * Longer words in a text (length >= 5), stemmed, minus the base stopwords. The
 * length floor drops the short generic vocabulary ("team", "work", "day") that
 * co-occurs in almost any two texts.
 */
function longWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * Domain words: longWords minus generic English. Genericness is judged mostly by
 * the COACH CORPUS itself (`coachVocab`) — generic prose about interview
 * technique — so words like "change"/"accept"/"which" that appear there are
 * dropped, while true document jargon ("handover", "supervisor", "tasking")
 * survives. Self-tuning to whatever corpus is loaded, no maintained list needed.
 */
function domainWords(text: string, coachVocab: Set<string>): Set<string> {
  return new Set(
    longWords(text).filter((w) => !coachVocab.has(w) && !COMMON_WORDS.has(w)),
  );
}

/**
 * Significant content-word bigrams in a text, stemmed and joined ("product
 * think"). Adjacency is taken over the QUALIFYING tokens (length >= 4, not a
 * base stopword), so intervening stopwords/short words don't block a phrase
 * ("product of thinking" still yields "product think"). A bigram is kept only
 * when it carries topical signal: NOT both stems generic (COMMON_WORDS) and at
 * least one raw token >= 6 chars — this drops generic verb phrases ("make sure",
 * "going back") while keeping real topic phrases ("product thinking",
 * "customer centric"). The point of the phrase signal is that a two-word term is
 * distinctive AS A PHRASE even when each word is individually generic — which is
 * exactly the case the per-word domainWords filter destroys (e.g. "product" is
 * in the coach corpus, "thinking" stems to a COMMON_WORD).
 */
function significantBigrams(text: string): Set<string> {
  const toks = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const out = new Set<string>();
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    const sa = stem(a);
    const sb = stem(b);
    if (COMMON_WORDS.has(sa) && COMMON_WORDS.has(sb)) continue; // pure boilerplate
    if (a.length < 6 && b.length < 6) continue; // both short/generic — noisy
    out.add(`${sa} ${sb}`);
  }
  return out;
}

/**
 * True when the transcript window is actually on a topic the uploaded documents
 * cover. Two independent signals, either sufficient:
 *   (a) it shares at least CONTEXT_MIN_OVERLAP distinct domain words with them; or
 *   (b) it shares a significant bigram (or the document title phrase) with them.
 * Signal (b) exists because (a) strips a document's own defining vocabulary when
 * that vocabulary reads as generic — the words in "product thinking" are dropped
 * ("product" is in the coach corpus, "thinking" is a COMMON_WORD), so a document
 * whose topic is ordinary business language could never ground on its own topic
 * being named. A verbatim two-word phrase shared with the docs (and their titles)
 * is strong, low-false-positive evidence, so it grounds regardless of (a).
 * Without this, the documents (always retrieved, being the bulk of the store)
 * either fail to surface on-topic or surface as "context" when never touched.
 */
/**
 * The uploaded documents' CHARACTERISTIC vocabulary — words distinctive to the
 * documents (recurring across a meaningful share of their chunks, see
 * CONTEXT_DOC_FREQ_FRACTION) plus distinctive phrases. Computed once per
 * suggestion pass and reused by both the context-grounding check and the coach
 * ask guard (which drops asks that import document vocabulary the speaker never
 * used). `coachVocab` is returned so callers can extract window domain words the
 * same way the profile was built.
 */
interface DocProfile {
  docWords: Set<string>;
  docBigrams: Set<string>;
  coachVocab: Set<string>;
}

async function getDocProfile(): Promise<DocProfile> {
  const { chunks } = await readStore();
  const coachVocab = new Set<string>();
  for (const c of chunks) {
    if (c.sourceType === "coach") for (const w of longWords(c.text)) coachVocab.add(w);
  }
  // Count each domain word's DOCUMENT FREQUENCY (how many chunks it appears in),
  // then keep only words characteristic of the document — see
  // CONTEXT_DOC_FREQ_FRACTION. domainWords() dedupes within a chunk, so adding
  // its output once per chunk yields a true per-chunk frequency.
  const docChunks = chunks.filter((c) => c.sourceType === "document");
  const docFreq = new Map<string, number>();
  const docBigramFreq = new Map<string, number>();
  for (const c of docChunks) {
    for (const w of domainWords(c.text.slice(0, MAX_CHUNK_CHARS), coachVocab)) {
      docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    }
    // Phrase signal draws on the chunk text AND the source label (the document
    // title is a curated, highly distinctive phrase — e.g. "Product thinking",
    // which, prepended to every chunk, recurs in all of them).
    for (const p of significantBigrams(`${c.sourceLabel} ${c.text.slice(0, MAX_CHUNK_CHARS)}`)) {
      docBigramFreq.set(p, (docBigramFreq.get(p) ?? 0) + 1);
    }
  }
  const minDocFreq = Math.max(1, Math.ceil(CONTEXT_DOC_FREQ_FRACTION * docChunks.length));
  const docWords = new Set<string>();
  for (const [w, f] of docFreq) if (f >= minDocFreq) docWords.add(w);
  // Characteristic bigrams only — same document-frequency floor as words. Without
  // it, a generic phrase that appears once in passing ("their ability") is
  // treated as a distinctive document term and wrongly grounds an unrelated
  // conversation (observed: a youth-council panel grounding on a product PDF).
  // The document TITLE, prepended to every chunk, always clears the floor, so
  // real title/theme phrases ("product thinking") survive.
  const docBigrams = new Set<string>();
  for (const [p, f] of docBigramFreq) if (f >= minDocFreq) docBigrams.add(p);
  return { docWords, docBigrams, coachVocab };
}

function isContextGrounded(query: string, profile: DocProfile): boolean {
  const { docWords, docBigrams, coachVocab } = profile;
  if (docWords.size === 0 && docBigrams.size === 0) return false;

  // Signal (b): a shared distinctive phrase.
  for (const p of significantBigrams(query)) {
    if (docBigrams.has(p)) return true;
  }

  // Signal (a): CONTEXT_MIN_OVERLAP distinct domain words.
  const said = domainWords(query, coachVocab);
  let overlap = 0;
  for (const w of said) {
    if (docWords.has(w) && ++overlap >= CONTEXT_MIN_OVERLAP) return true;
  }
  return false;
}

/**
 * True when a specific "context" card is actually about what is being discussed
 * RIGHT NOW — not merely drawn from a document whose broad topic the window
 * grazes. `isContextGrounded` gates on window↔document topicality (does the
 * conversation touch anything the docs cover?), but that gate passes as soon as
 * the window shares any CONTEXT_MIN_OVERLAP characteristic words with a
 * document — so on a business-adjacent store a single business PDF grounds
 * almost any conversation, and the model is then free to surface ANY card from
 * it. Observed leaks (a youth/careers panel, product-thinking PDF): a card about
 * "websites prioritise marketing over customer needs" on a window about career
 * ladders, and "…generative AI…" on a window that never mentioned AI — each
 * shared 0–1 content words with the actual talk. This is the missing half of
 * grounding: the CARD must connect to the WINDOW, not just the window to the
 * document. Require the card's own distinctive content to overlap the transcript
 * window by a shared significant phrase, or CONTEXT_MIN_OVERLAP distinct domain
 * words. A genuinely relevant card echoes the topic being discussed (on-topic
 * windows share 5+ domain words with matching docs), so this is a wide margin;
 * an off-topic card imported from a grazed document shares nothing and drops.
 * Cards with no distinctive content of their own (all generic/coach vocabulary)
 * can't be judged relevant, so they drop too — a context card that says nothing
 * document-specific carries no value.
 */
function contextCardRelevant(body: string, query: string, profile: DocProfile): boolean {
  const { coachVocab } = profile;
  if (!body) return false;

  const winBigrams = significantBigrams(query);
  for (const p of significantBigrams(body)) {
    if (winBigrams.has(p)) return true;
  }

  const winWords = domainWords(query, coachVocab);
  const cardWords = domainWords(body, coachVocab);
  let overlap = 0;
  for (const w of cardWords) {
    if (winWords.has(w) && ++overlap >= CONTEXT_MIN_OVERLAP) return true;
  }
  return false;
}

/**
 * True unless a coach ask imports DOCUMENT vocabulary the speaker never used.
 * The coach may be INFORMED by the uploaded documents, but a coach ask is read
 * aloud to the participant as if grounded in what they just said — so it must
 * never attribute a document's concepts to the conversation ("the product
 * thinking principles you mentioned earlier" when no one mentioned them). Drops
 * the ask when it contains a characteristic document word (see getDocProfile)
 * that is absent from the transcript window. Conservative: only document-
 * distinctive vocabulary triggers it, so ordinary asks grounded in what was
 * said always pass. Uses the same 5-char-prefix window match as askIsGrounded
 * so morphological variants still count as present.
 */
function askAvoidsUngroundedDocTerms(
  ask: string,
  query: string,
  profile: DocProfile,
): boolean {
  const a = (ask ?? "").trim();
  if (!a || (profile.docWords.size === 0 && profile.docBigrams.size === 0)) return true;
  // Strong signal — a distinctive document PHRASE (including the title, e.g.
  // "product thinking", "cross-disciplinary") the ask uses but the window never
  // did. Phrases are low-false-positive, so one is enough to drop.
  const winBigrams = significantBigrams(query);
  for (const p of significantBigrams(a)) {
    if (profile.docBigrams.has(p) && !winBigrams.has(p)) return false;
  }
  // Weak signal — single document-characteristic words absent from the window.
  // A lone one over-fires (a generic business word like "approach"/"align" that
  // merely also appears in the docs), so require CONTEXT_MIN_OVERLAP of them, and
  // skip generic coaching vocabulary a good ask legitimately uses.
  const winPrefixes = new Set(longWords(query).map((w) => w.slice(0, 5)));
  let imported = 0;
  for (const w of domainWords(a, profile.coachVocab)) {
    if (COACHING_VOCAB.has(w)) continue;
    if (profile.docWords.has(w) && !winPrefixes.has(w.slice(0, 5))) {
      if (++imported >= CONTEXT_MIN_OVERLAP) return false;
    }
  }
  return true;
}

/**
 * Leading / yes-no question patterns for a coach ask. Negative-inversion openers
 * ("isn't it", "aren't", "don't you", "wouldn't"…) and "what makes you think"
 * are reliably leading; a trailing tag ("…, right?") makes any question leading.
 * Deliberately does NOT match open requests ("Can you tell me…", "What does…",
 * "How did…", "Tell me about…"), which are fine.
 */
const LEADING_ASK_PATTERNS: RegExp[] = [
  /^\s*(?:but\s+|and\s+|so\s+)?(?:isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|wouldn'?t|couldn'?t|shouldn'?t|won'?t|can'?t|haven'?t|hasn'?t|hadn'?t)\b/i,
  /^\s*what\s+makes?\s+you\s+think\b/i,
  /,\s*(?:right|correct|no|yeah|yes|isn'?t\s+it|aren'?t\s+(?:you|they|we|it)|don'?t\s+you|wouldn'?t\s+you)\s*\?*\s*$/i,
];

function isLeadingAsk(ask: string): boolean {
  const a = (ask ?? "").trim();
  return a.length > 0 && LEADING_ASK_PATTERNS.some((re) => re.test(a));
}

/**
 * Generic coaching vocabulary a good ask legitimately uses that is NOT a
 * "topic" word — so it doesn't count as introducing a concept absent from the
 * transcript. Stemmed to match `stem()`.
 */
const COACHING_VOCAB = new Set(
  [
    "specific", "specifically", "example", "experience", "moment", "process",
    "value", "reason", "cause", "causing", "driving", "underlying", "goal",
    "meaning", "achieve", "represent", "describe", "elaborate", "imagine",
    "consider", "happen", "recent", "context", "something", "someone", "walk",
    "think", "feel", "concern", "frustration", "difficulty", "challenge",
    "struggle", "problem", "issue", "worry", "negative", "better", "different",
  ].map(stem),
);

/**
 * True unless the coach ask is ENTIRELY about a concrete topic absent from the
 * transcript window (a hallucinated premise). Only drops when the ask introduces
 * at least one distinctive topical word (length >= 5, not stopword, not generic
 * coaching vocab) AND shares NO topical word with the window — so deictic and
 * partially-grounded asks always pass.
 */
function askIsGrounded(ask: string, query: string): boolean {
  const a = (ask ?? "").trim();
  if (!a) return true;
  const words = (s: string) =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  // Match on a 5-char prefix rather than exact stem, so morphological variants
  // ("isolated"/"isolation", "socially"/"social") still count as grounded. This
  // errs toward KEEPING (a loose match keeps the ask) — the safe direction.
  const winPrefixes = new Set(words(query).map((w) => w.slice(0, 5)));
  const topical = words(a).filter((w) => !COACHING_VOCAB.has(stem(w)));
  if (topical.length === 0) return true; // no topic asserted (deictic) — keep
  return topical.some((w) => winPrefixes.has(w.slice(0, 5)));
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sentences in the snippet that end in a question mark. */
function extractQuestions(text: string): string[] {
  return (text.match(/[^.!?]+\?/g) ?? []).map((q) => q.trim());
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "you", "your", "it", "is", "was", "do", "did", "does", "how", "what", "when",
  "that", "this", "about", "me", "we", "they", "he", "she", "at", "by", "have",
]);

/** Crude stemmer so "handled"/"handle", "calls"/"call" count as the same word. */
function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "");
}

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem),
  );
}

/**
 * True when one question's content words are largely contained in the
 * other's. Containment (not Jaccard) so a padded rephrasing of a shorter
 * question still counts as an echo. Deliberately aggressive: re-covering
 * ground already covered is worse than occasionally muting a same-topic
 * follow-up.
 */
function isEcho(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap >= 3 && overlap / Math.min(wa.size, wb.size) >= 0.6;
}

/* ---------------- Anthropic (premium) ---------------- */

// Model is env-configurable so any available frontier model can be swapped in
// without a code change. Base URL is overridable too: the Anthropic SDK reads
// ANTHROPIC_BASE_URL natively, so an internal/enclave gateway that speaks the
// Anthropic API needs no code change either (relevant where a restricted
// environment exposes frontier models through a governed endpoint).
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

async function viaAnthropic(user: string, system: string): Promise<Suggestion[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (required by SUGGEST_PROVIDER=anthropic).");
  }
  const client = new Anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") return [];
  const text = response.content.find((b) => b.type === "text");
  return text ? (JSON.parse(text.text).suggestions ?? []) : [];
}

/* ---------------- Ollama (local, free, default) ---------------- */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1:8b";

async function viaOllama(user: string, system: string): Promise<Suggestion[]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: SCHEMA, // Ollama structured outputs: constrain to the JSON schema
        keep_alive: "30m", // stay resident for the whole interview
        options: { temperature: 0.2, num_predict: 512 },
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
  return parseSuggestions(json.message?.content ?? "");
}

/* ---------------- llama.cpp (bundled local server, offline default in the packaged app) ---------------- */

// llama.cpp's `llama-server` exposes an OpenAI-compatible API. It must use the
// GRAMMAR-ENFORCED `json_schema` response_format (not `json_object`): with a
// bare `json_object` the schema is only *described* in the prompt, and the 8B
// model parrots the schema's shape back ({"type":"object","properties":…})
// instead of an instance of it — parseSuggestions then finds no top-level
// `suggestions` key and silently returns []. `json_schema` constrains
// generation to the schema server-side (like Ollama's `format`), so the output
// is a valid instance and the system prompt needs no schema dump.
const LLAMACPP_URL = process.env.LLAMACPP_URL ?? "http://localhost:8080";

async function viaLlamaCpp(user: string, system: string): Promise<Suggestion[]> {
  let res: Response;
  try {
    res = await fetch(`${LLAMACPP_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // llama-server serves whichever model it was launched with; the field
        // is required by the OpenAI shape but the value is ignored.
        model: "insight-local",
        temperature: 0.2,
        // Bound worst-case latency: one terse suggestion is well under this, so
        // it only trips on a degenerate run-on (which we'd discard anyway).
        max_tokens: 256,
        // Grammar-constrained JSON: llama.cpp enforces the schema server-side.
        response_format: { type: "json_schema", json_schema: { name: "suggestions", schema: SCHEMA } },
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
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseSuggestions(json.choices?.[0]?.message?.content ?? "");
}

/* ---------------- Groq (hosted free tier) ---------------- */

async function viaGroq(user: string, system: string): Promise<Suggestion[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not set (required by SUGGEST_PROVIDER=groq).");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${system}\n\nRespond with a single JSON object matching this schema exactly:\n${JSON.stringify(SCHEMA)}`,
        },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return parseSuggestions(json.choices?.[0]?.message?.content ?? "");
}

/* ---------------- shared parsing ---------------- */

function parseSuggestions(content: string): Suggestion[] {
  if (!content.trim()) return [];
  try {
    const parsed = JSON.parse(content) as { suggestions?: Suggestion[] };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  } catch {
    // Small models occasionally wrap JSON in prose — try to salvage.
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as { suggestions?: Suggestion[] };
        return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}
