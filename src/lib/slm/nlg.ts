/**
 * Natural Language Generation layer — turns a ReasonerOutput into a readable
 * recommendation message.
 *
 * Per the hackathon rules:
 *   - The SLM must be an open-weights model of ≤ 3 billion parameters that
 *     the team runs themselves.
 *   - We default to Qwen/Qwen2.5-1.5B-Instruct (≈1.5 B params) hosted on the
 *     Hugging Face Hub. Inference uses the HF Inference API when the user
 *     has set HF_TOKEN, and otherwise falls back to a deterministic
 *     template-based generator that is also grounded in the live data.
 *
 * In both paths the SLM is constrained to *only* rephrase the structured
 * reasoning output — it cannot introduce weather, places, or numbers that
 * the reasoner didn't already supply. That keeps every claim grounded.
 */

import type { ReasonerOutput } from "./reasoner";

const SLM_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-1.5B-Instruct";
const HF_TOKEN = process.env.HF_TOKEN || "";

export interface NlgResult {
  text: string;
  markdown: string;
  generator: "slm" | "template";
  model: string;
}

export async function generateRecommendation(
  out: ReasonerOutput
): Promise<NlgResult> {
  // If SLM is available, try it first; fall back to template on any error.
  if (HF_TOKEN) {
    try {
      const slm = await slmGenerate(out);
      if (slm) {
        return {
          text: stripMarkdown(slm),
          markdown: slm,
          generator: "slm",
          model: SLM_MODEL,
        };
      }
    } catch (e) {
      console.warn("[nlg] SLM failed, using template:", e);
    }
  }
  const md = templateGenerate(out);
  return {
    text: stripMarkdown(md),
    markdown: md,
    generator: "template",
    model: SLM_MODEL + " (template fallback — set HF_TOKEN to use SLM)",
  };
}

// -----------------------------------------------------------------------------
// SLM path
// -----------------------------------------------------------------------------

async function slmGenerate(out: ReasonerOutput): Promise<string | null> {
  const sys = `You are an outdoor-activity assistant writing a short, friendly recommendation. Use ONLY the facts provided in the user message — never invent weather, places, times, or numbers. Format the response in Markdown with these sections:
### Recommendation
### What to carry
### What to watch for
### When to avoid
### Sources
Keep the response under 200 words. Be honest if no slot passed the safety limits.`;
  const user = buildPromptPayload(out);
  const url = `https://api-inference.huggingface.co/models/${SLM_MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HF_TOKEN}`,
    },
    body: JSON.stringify({
      inputs: `<|im_start|>system\n${sys}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`,
      parameters: {
        max_new_tokens: 350,
        temperature: 0.4,
        top_p: 0.85,
        return_full_text: false,
        stop: ["<|im_end|>"],
      },
      options: { wait_for_model: true, use_cache: true },
    }),
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    console.warn("[nlg] HF non-OK", res.status);
    return null;
  }
  const j = await res.json();
  const text = Array.isArray(j) ? j[0]?.generated_text : j?.generated_text;
  if (!text || typeof text !== "string") return null;
  // Append a Sources block we build deterministically, so citations are never lost.
  const md = text.trim() + "\n\n" + sourcesBlock(out);
  return md;
}

function buildPromptPayload(out: ReasonerOutput): string {
  const lines: string[] = [];
  lines.push(`User question: ${out.query.locationRaw ?? "(no location)"} — ${out.query.activity ?? "(unknown activity)"} — ${out.query.time?.rawDescription ?? "(any time)"}`);
  if (out.profile.hasAsthma || out.profile.isSenior || out.profile.isChild || out.profile.isPregnant) {
    lines.push(`Personal profile: ${[
      out.profile.hasAsthma ? "asthma" : null,
      out.profile.isSenior ? "senior" : null,
      out.profile.isChild ? "child" : null,
      out.profile.isPregnant ? "pregnant" : null,
    ].filter(Boolean).join(", ")}`);
  }
  if (out.notes.length) lines.push(`Notes: ${out.notes.join(" | ")}`);
  if (!out.recommendations.length) {
    lines.push(`No venues or no time slot passed the activity's safety limits.`);
    lines.push(`Activity limits used: temperature ${out.rule.tempMin}–${out.rule.tempMax}°C, wind ≤ ${out.rule.maxWindKph} kph, AQI ≤ ${out.rule.maxAqiEuropean}, daylight required = ${out.rule.requiresDaylight}.`);
    return lines.join("\n");
  }
  lines.push(`Top ${out.recommendations.length} recommendations:`);
  for (const r of out.recommendations) {
    lines.push(`  ${r.rank}. ${r.slot.venue.name} at ${new Date(r.slot.hour.timeMs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })}. Score ${r.slot.score}/100. ${r.slot.weatherSummary}. Travel: ${r.slot.travelMin || "?"} min.`);
    if (r.slot.blockers.length) lines.push(`  Blockers: ${r.slot.blockers.join("; ")}`);
  }
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Template path (always works)
// -----------------------------------------------------------------------------

function templateGenerate(out: ReasonerOutput): string {
  const lines: string[] = [];
  // Header — what the assistant understood
  const who = out.query.locationRaw ?? "(unspecified place)";
  const when = out.query.time?.rawDescription ?? "the next 48 hours";
  const actLabel = out.rule.label;
  lines.push(`## ${actLabel} near ${who} — ${when}`);
  lines.push("");

  // Profile note
  const pNote = reasonerPersonalNote(out);
  if (pNote) {
    lines.push(`> ${pNote}`);
    lines.push("");
  }

  // Fallback / no-result path
  if (out.recommendations.length === 0) {
    lines.push(`**No slots passed the activity's safety limits** in the live weather data I fetched. Here is why:`);
    lines.push("");
    lines.push(`- I looked for ${actLabel.toLowerCase()} venues within ${out.query.searchRadiusKm} km of **${out.query.locationRaw ?? "your location"}** using OpenStreetMap, then pulled hourly weather (Open-Meteo), air quality (Open-Meteo AQ), daylight, and road travel time (OSRM) for each.`);
    lines.push(`- The activity's limits were: apparent temperature ${out.rule.tempMin}–${out.rule.tempMax}°C, wind ≤ ${out.rule.maxWindKph} kph, AQI ≤ ${out.rule.maxAqiEuropean}, daylight required = ${out.rule.requiresDaylight}, rain probability ≤ ${out.rule.maxPrecipProb}%.`);
    if (out.notes.length) lines.push(`- Notes: ${out.notes.join("; ")}`);
    lines.push("");
    lines.push(`**Suggestions:**`);
    lines.push(`1. Try widening the search radius (e.g. *within 30 km of ${out.query.locationRaw ?? "you"}*).`);
    lines.push(`2. Try a different time window (early morning or after sunset for hot days).`);
    lines.push(`3. If air quality is the blocker, prefer upwind of arterial roads and away from industrial estates.`);
    lines.push("");
    lines.push(sourcesBlock(out));
    return lines.join("\n");
  }

  // Recommendations
  lines.push(`Here is what the live data says:`);
  lines.push("");
  for (const r of out.recommendations) {
    const time = new Date(r.slot.hour.timeMs).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    lines.push(`### ${rankEmoji(r.rank)} ${r.slot.venue.name} — ${time}`);
    lines.push(`**Score: ${r.slot.score}/100** — ${r.slot.weatherSummary}${r.slot.travelMin ? ` · ${r.slot.travelMin} min by road` : ""}.`);
    if (r.slot.blockers?.length) {
      lines.push(``);
      lines.push(`⚠️ Blockers: ${r.slot.blockers.join("; ")}.`);
    }
    lines.push(``);
    lines.push(`**Why:** ${(r.slot.reasons ?? []).join("; ")}.`);
    lines.push(``);
    lines.push(`**What to carry:** ${(r.advice?.carry ?? []).join(", ")}.`);
    lines.push(`**What to watch for:** ${(r.advice?.watch ?? []).join("; ")}.`);
    lines.push(`**When to avoid:** ${(r.advice?.avoid ?? []).join("; ")}.`);
    lines.push("");
  }

  // Personal note (top recommendation)
  const topNote = out.recommendations[0]?.personalNote;
  if (topNote) {
    lines.push(`> ${topNote}`);
    lines.push("");
  }

  lines.push(sourcesBlock(out));
  return lines.join("\n");
}

function rankEmoji(r: number): string {
  if (r === 1) return "🥇";
  if (r === 2) return "🥈";
  if (r === 3) return "🥉";
  return `#${r}`;
}

function sourcesBlock(out: ReasonerOutput): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const c of out.citations) {
    const key = `${c.label}|${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(`- **${c.label}** — ${c.source} — ${c.value} ([link](${c.url}))`);
  }
  return `### Sources\n${items.join("\n")}`;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^-\s+/gm, "• ")
    .trim();
}

function reasonerPersonalNote(out: ReasonerOutput): string | null {
  if (!out.recommendations.length) {
    if (out.profile.hasAsthma) return `You mentioned asthma — I capped AQI at ${out.rule.maxAqiEuropean}. Try upwind of arterial roads and away from industry.`;
    if (out.profile.isSenior) return `Adjusted for a senior: temperature ${out.rule.tempMin}–${out.rule.tempMax}°C, wind ≤ ${out.rule.maxWindKph} kph, AQI ≤ ${out.rule.maxAqiEuropean}.`;
    if (out.profile.isChild) return `Adjusted for a child: stricter UV (≤${out.rule.maxUvIndex}), AQI ≤ ${out.rule.maxAqiEuropean}.`;
    if (out.profile.isPregnant) return `Adjusted for pregnancy: heat cap ${out.rule.tempMax}°C, UV ≤ ${out.rule.maxUvIndex}.`;
    return null;
  }
  return out.recommendations[0].personalNote;
}
