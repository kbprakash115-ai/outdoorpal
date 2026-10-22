/**
 * Query parser — extracts activity, location, time range, and personal profile
 * from a free-form natural-language question.
 *
 * Per the hackathon spec, this is the "small language model" component: it uses
 * an open-weights model of ≤ 3B parameters (configurable via HF_TOKEN + the
 * SLM_MODEL env var, defaulting to Qwen/Qwen2.5-1.5B-Instruct). When the SLM
 * is unavailable (no token / network), it falls back to a deterministic
 * rule-based parser. Both paths produce the same structured `ParsedQuery` so
 * the rest of the pipeline is unchanged.
 */

import { ACTIVITY_SYNONYMS, PersonalProfile } from "./activities";
import type { ActivityKind } from "@/lib/geo/overpass";

export interface ParsedTimeRange {
  startMs: number;
  endMs: number;
  rawDescription: string;       // human-readable, used in the response
  candidateHoursUTC: number[];  // UTC hours-of-day to consider
}

export interface ParsedQuery {
  activity: ActivityKind | null;
  activityRaw: string | null;   // what the user actually said
  locationRaw: string | null;
  searchRadiusKm: number;       // default 10
  time: ParsedTimeRange | null;
  profile: PersonalProfile;
  ambiguous: string[];          // reasons this query is incomplete / messy
  warnings: string[];           // e.g. "outside scope"
}

const DEFAULT_RADIUS_KM = 10;
const DEFAULT_LOOKAHEAD_HOURS = 48;

/** Convert a free-form question into a structured `ParsedQuery`. */
export async function parseQuery(
  question: string,
  opts?: { slmCall?: (sys: string, user: string) => Promise<string | null> }
): Promise<ParsedQuery> {
  const q = question.trim();

  // 1. Try SLM if provided
  if (opts?.slmCall) {
    try {
      const slmOut = await slmParse(q, opts.slmCall);
      if (slmOut) {
        return mergeWithHeuristics(slmOut, q);
      }
    } catch (e) {
      console.warn("[parser] SLM failed, falling back to rules:", e);
    }
  }

  // 2. Deterministic rule-based parser (always works)
  return ruleBasedParse(q);
}

// -----------------------------------------------------------------------------
// SLM-based parse
// -----------------------------------------------------------------------------

const SLM_SYS = `You are a JSON-only extractor for an outdoor-activity assistant. Given a user's free-form question, return a JSON object with this exact shape:
{
  "activity": "running|cycling|golf|cricket|football|tennis|hiking|picnic|event|photography|null",
  "location": string | null,
  "radiusKm": number | null,
  "time": "today_afternoon|tomorrow_morning|tomorrow_evening|this_weekend|next_two_days|saturday|sunday|null",
  "profile": { "asthma": bool, "senior": bool, "child": bool, "pregnant": bool },
  "ambiguous": [string]
}
Return ONLY JSON, no prose. Use null when the user did not specify.`;

async function slmParse(
  q: string,
  slmCall: (sys: string, user: string) => Promise<string | null>
): Promise<Partial<SlmParseOutput> | null> {
  const out = await slmCall(SLM_SYS, q);
  if (!out) return null;
  const json = extractJson(out);
  if (!json) return null;
  return json as Partial<SlmParseOutput>;
}

interface SlmParseOutput {
  activity: ActivityKind | null;
  location: string | null;
  radiusKm: number | null;
  time: string | null;
  profile: { asthma: boolean; senior: boolean; child: boolean; pregnant: boolean };
  ambiguous: string[];
}

function extractJson(s: string): any | null {
  // strip code fences
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1];
  // find first {...}
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function mergeWithHeuristics(slm: Partial<SlmParseOutput>, original: string): ParsedQuery {
  const profile: PersonalProfile = {
    hasAsthma: !!slm.profile?.asthma,
    isSenior: !!slm.profile?.senior,
    isChild: !!slm.profile?.child,
    isPregnant: !!slm.profile?.pregnant,
  };
  const ambiguous = Array.isArray(slm.ambiguous) ? slm.ambiguous : [];
  const activity = (slm.activity ?? activityFromText(original)) as ActivityKind | null;
  const location = slm.location ?? locationFromText(original);
  const radiusKm = slm.radiusKm ?? radiusFromText(original) ?? DEFAULT_RADIUS_KM;
  const time = timeFromToken(slm.time ?? timeFromTextToken(original), original);

  if (!activity) ambiguous.push("activity not recognised");
  if (!location) ambiguous.push("no location given");

  return {
    activity,
    activityRaw: activity ?? null,
    locationRaw: location,
    searchRadiusKm: radiusKm,
    time,
    profile,
    ambiguous,
    warnings: [],
  };
}

// -----------------------------------------------------------------------------
// Rule-based parse (always-available fallback)
// -----------------------------------------------------------------------------

function ruleBasedParse(q: string): ParsedQuery {
  const lower = q.toLowerCase();
  const activity = activityFromText(lower);
  const location = locationFromText(lower);
  const radiusKm = radiusFromText(lower) ?? DEFAULT_RADIUS_KM;
  const profile: PersonalProfile = {
    hasAsthma: /asthma|inhaler/.test(lower),
    isSenior: /\b(senior|elderly|grandparent|grandmom|granddad|parents?|old age)\b/.test(lower),
    isChild: /\b(child|kid|kids|toddler|children|son|daughter|child's)\b/.test(lower),
    isPregnant: /\b(pregnant|pregnancy)\b/.test(lower),
  };
  const timeToken = timeFromTextToken(lower);
  const time = timeFromToken(timeToken, lower);

  const ambiguous: string[] = [];
  if (!activity) ambiguous.push("activity not recognised — please name it (run, cycle, golf, cricket, football, tennis, hike, picnic, event, photography)");
  if (!location) ambiguous.push("no location given — please name a place or area");
  if (timeToken === null) ambiguous.push("no time given — defaulting to the next 48 hours");

  // Out-of-scope check
  const warnings: string[] = [];
  if (/\b(indoor|indoors|swimming pool|gym|movie|cinema)\b/.test(lower)) {
    warnings.push("the requested activity looks indoor — this assistant focuses on outdoor activity");
  }

  return {
    activity,
    activityRaw: activity,
    locationRaw: location,
    searchRadiusKm: radiusKm,
    time,
    profile,
    ambiguous,
    warnings,
  };
}

function activityFromText(lower: string): ActivityKind | null {
  for (const key in ACTIVITY_SYNONYMS) {
    const re = new RegExp(`\\b${key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) return ACTIVITY_SYNONYMS[key];
  }
  // also a final regex check for "morning walk" (handled by synonyms) and "go running"
  if (/going to run|go for a run|go running/.test(lower)) return "running";
  return null;
}

function locationFromText(lower: string): string | null {
  // patterns like "near X", "around X", "within N km of X", "in X"
  const m = lower.match(/(?:near|around|in|at|close to|within\s+\d+\s*km\s+of|from)\s+([A-Za-z][A-Za-z0-9\s,'.-]{2,60}?)(?:\?|\.|,|$| this| tomorrow| today| weekend| evening| morning| saturday| sunday| in the next| next two| for a| is| are| on| at)/);
  if (m) return m[1].trim();
  // strip question and try a broad fallback
  const cleaned = lower
    .replace(/\b(where can i|best place|good place|good time|best time|is it ok|is it okay|should i|what (time|place)|recommend|suggest|planning|planning an?)\b/g, "")
    .replace(/\?/g, "")
    .replace(/^(can you|please)\s+/g, "")
    .trim();
  // Try a sequence of capitalized words from original-case text by re-searching
  return cleaned.length > 0 ? cleaned.slice(0, 60) : null;
}

function radiusFromText(lower: string): number | null {
  const m = lower.match(/\bwithin\s+(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?)\b/);
  if (m) return Math.max(1, Math.min(80, parseFloat(m[1])));
  const m2 = lower.match(/\b(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?)\s+(?:of|from|radius)\b/);
  if (m2) return Math.max(1, Math.min(80, parseFloat(m2[1])));
  return null;
}

function timeFromTextToken(lower: string): string | null {
  if (/\btoday\b/.test(lower) && /\b(afternoon|evening|morning|after lunch)\b/.test(lower)) {
    if (/\bmorning\b/.test(lower)) return "today_morning";
    if (/\bafternoon\b/.test(lower)) return "today_afternoon";
    if (/\bevening\b/.test(lower)) return "today_evening";
  }
  if (/\btomorrow\b/.test(lower)) {
    if (/\bmorning\b/.test(lower)) return "tomorrow_morning";
    if (/\bafternoon\b/.test(lower)) return "tomorrow_afternoon";
    if (/\bevening\b/.test(lower)) return "tomorrow_evening";
    return "tomorrow";
  }
  if (/this weekend/.test(lower)) return "this_weekend";
  if (/\bsaturday\b/.test(lower)) return "saturday";
  if (/\bsunday\b/.test(lower)) return "sunday";
  if (/\bnext two days\b|next 2 days|next two days/.test(lower)) return "next_two_days";
  if (/\bin the next\b/.test(lower)) {
    const m = lower.match(/in the next (\d+) days?/);
    if (m) return `next_${m[1]}_days`;
  }
  if (/\btonight\b/.test(lower)) return "today_evening";
  if (/\b(this evening|sunset)\b/.test(lower)) return "today_evening";
  if (/\bafter work\b/.test(lower)) return "today_evening";
  if (/\b8\s*am\b|\b9\s*am\b|\b10\s*am\b|\bmorning\b/.test(lower)) return "today_morning";
  if (/\b\d{1,2}\s*(am|pm)\b/.test(lower)) return "today_afternoon";
  return null;
}

function timeFromToken(token: string | null, original: string): ParsedTimeRange | null {
  const now = Date.now();
  const kolkataHourOffset = 5.5 * 3600 * 1000;
  const todayMidnightUTC = Math.floor(now / 86400000) * 86400000;
  const startOfTodayIST = todayMidnightUTC - (5.5 * 3600 * 1000);
  const endOfTodayIST = startOfTodayIST + 86400000;
  const startOfTomorrowIST = endOfTodayIST;
  const startOfDayAfterTomorrowIST = startOfTomorrowIST + 86400000;
  const startOfWeekend = nextWeekendStart(startOfTodayIST);

  switch (token) {
    case "today_morning":
      return range(startOfTodayIST, startOfTodayIST + 12 * 3600000, "today morning", [4, 5, 6, 7, 8, 9, 10, 11]);
    case "today_afternoon":
      return range(startOfTodayIST + 12 * 3600000, endOfTodayIST, "today afternoon", [12, 13, 14, 15, 16, 17]);
    case "today_evening":
      return range(startOfTodayIST + 16 * 3600000, startOfTodayIST + 22 * 3600000, "this evening", [16, 17, 18, 19, 20, 21]);
    case "tomorrow_morning":
      return range(startOfTomorrowIST, startOfTomorrowIST + 12 * 3600000, "tomorrow morning", [4, 5, 6, 7, 8, 9, 10, 11]);
    case "tomorrow_afternoon":
      return range(startOfTomorrowIST + 12 * 3600000, startOfTomorrowIST + 18 * 3600000, "tomorrow afternoon", [12, 13, 14, 15, 16, 17]);
    case "tomorrow_evening":
      return range(startOfTomorrowIST + 17 * 3600000, startOfTomorrowIST + 21 * 3600000, "tomorrow evening", [17, 18, 19, 20]);
    case "tomorrow":
      return range(startOfTomorrowIST, startOfTomorrowIST + 86400000, "tomorrow", allHours());
    case "this_weekend":
      return range(startOfWeekend, startOfWeekend + 2 * 86400000, "this weekend (Sat–Sun)", allHours());
    case "saturday":
      return range(startOfWeekend, startOfWeekend + 86400000, "Saturday", allHours());
    case "sunday":
      return range(startOfWeekend + 86400000, startOfWeekend + 2 * 86400000, "Sunday", allHours());
    case "next_two_days":
      return range(now, now + 2 * 86400000, "the next two days", allHours());
    default:
      if (token?.startsWith("next_") && token.endsWith("_days")) {
        const n = parseInt(token.replace("next_", "").replace("_days", ""));
        const days = Number.isFinite(n) ? n : 2;
        return range(now, now + days * 86400000, `the next ${days} days`, allHours());
      }
      // Fallback: next 48h
      return range(now, now + DEFAULT_LOOKAHEAD_HOURS * 3600000, "the next 48 hours", allHours());
  }
}

function nextWeekendStart(nowMs: number): number {
  const d = new Date(nowMs);
  // getDay(): 0 Sun, 6 Sat. We want next Saturday 00:00 local.
  const today = d.getDay();
  let daysUntilSaturday = (6 - today + 7) % 7;
  if (daysUntilSaturday === 0) {
    // Today is Saturday — but is it past midnight? Always start at today's midnight for simplicity.
    daysUntilSaturday = 0;
  }
  const midnight = new Date(d);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() + daysUntilSaturday * 86400000;
}

function allHours(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

function range(startMs: number, endMs: number, rawDescription: string, candidateHoursUTC: number[]): ParsedTimeRange {
  return { startMs, endMs, rawDescription, candidateHoursUTC };
}
