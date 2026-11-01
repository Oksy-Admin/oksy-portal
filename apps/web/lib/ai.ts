// Rule Library "plain-words box" (stage-plan 2d, decisions.md section 9). Same model and
// call shape as packages/worker/src/ai-mapping.ts's suggestWithClaude, but run from the web
// app itself (interactive, not a queued worker job) -- so it needs its own ANTHROPIC_API_KEY
// in apps/web's environment (see .env.example); when it is not set, the box is simply
// unavailable, the same graceful-degradation the worker's own AI mapping already uses.
import Anthropic from "@anthropic-ai/sdk";
import { buildRuleDraftPrompt, parseRuleDraftResponse, RULE_DRAFT_SCHEMA, type RuleDraftSuggestion } from "@oksy/rules";

export const AI_MODEL = "claude-opus-5-5";

export async function suggestRuleDraft(sentence: string): Promise<{ suggestion: RuleDraftSuggestion } | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "The plain-words box needs ANTHROPIC_API_KEY added to the web app's environment (ask Anoop)." };
  }
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: RULE_DRAFT_SCHEMA } },
      messages: [{ role: "user", content: buildRuleDraftPrompt(sentence) }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { error: "The AI could not draft a rule from that sentence; try rephrasing it." };
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { suggestion: parseRuleDraftResponse(text) };
  } catch (e) {
    return { error: `The AI call failed: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}
