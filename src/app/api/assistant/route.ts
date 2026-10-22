/**
 * POST /api/assistant
 *
 * Main entry point of the outdoor-activity assistant.
 *
 * Request body (JSON):
 *   { "question": "Where can I go running tomorrow evening near Koregaon Park?" }
 *
 * Response (JSON):
 *   {
 *     "answer":      "## Running near Koregaon Park — tomorrow evening\n...",
 *     "answer_text": "...",
 *     "reasoner":    { ...full reasoner output, including recommendations, citations... },
 *     "generator":   "slm" | "template",
 *     "model":       "Qwen/Qwen2.5-1.5B-Instruct",
 *     "data_sources": [...],
 *     "elapsed_ms":  1234
 *   }
 *
 * All weather, places, and times in the answer come from the live data the
 * reasoner fetched; the SLM is only used to naturalise the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/slm/parser";
import { reason } from "@/lib/slm/reasoner";
import { generateRecommendation } from "@/lib/slm/nlg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATA_SOURCES = [
  { name: "OpenStreetMap (via Overpass API)", url: "https://overpass-api.de/", note: "venues, roads, industry, parks, water" },
  { name: "Nominatim (geocoding)", url: "https://nominatim.openstreetmap.org/", note: "place name → coordinates" },
  { name: "Open-Meteo Forecast", url: "https://open-meteo.com/en/docs", note: "hourly + daily weather" },
  { name: "Open-Meteo Air Quality", url: "https://open-meteo.com/en/docs/air-quality-api", note: "PM10, PM2.5, AQI" },
  { name: "OSRM (routing)", url: "https://router.project-osrm.org/", note: "road travel time" },
  { name: "Hugging Face Hub (SLM)", url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct", note: "Qwen2.5-1.5B-Instruct (open-weights, ≤3B params)" },
];

const SLM_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-1.5B-Instruct";

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let question = "";
  try {
    const body = await req.json().catch(() => ({}));
    question = (body?.question ?? "").toString().trim();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json(
      { error: "Please provide a 'question' field in the JSON body." },
      { status: 400 }
    );
  }
  if (question.length > 800) {
    return NextResponse.json(
      { error: "Question too long (max 800 chars)." },
      { status: 413 }
    );
  }

  try {
    const parsed = await parseQuery(question);
    const reasoned = await reason(parsed);
    const nlg = await generateRecommendation(reasoned);

    return NextResponse.json({
      question,
      answer: nlg.markdown,
      answer_text: nlg.text,
      generator: nlg.generator,
      model: nlg.model,
      slm: {
        model_repo: SLM_MODEL,
        parameter_count: "~1.5B (within the 3B cap)",
        license: "Qwen license (open)",
        hosted_at: "https://huggingface.co/" + SLM_MODEL,
        invocation: HF_TOKEN_AVAILABLE() ? "Hugging Face Inference API" : "template fallback (no HF_TOKEN set)",
      },
      reasoner: {
        activity: reasoned.activity,
        activity_label: reasoned.rule.label,
        profile: reasoned.profile,
        origin: reasoned.origin,
        candidates: reasoned.candidates,
        scored: reasoned.scored,
        recommendations: reasoned.recommendations.map((r) => ({
          rank: r.rank,
          venue_name: r.slot.venue.name,
          venue_type: r.slot.venue.type,
          venue_lat: r.slot.venue.lat,
          venue_lon: r.slot.venue.lon,
          venue_distance_m: r.slot.venue.distanceM,
          slot_time_iso: new Date(r.slot.hour.timeMs).toISOString(),
          slot_time_local: new Date(r.slot.hour.timeMs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
          score: r.slot.score,
          ok: r.slot.ok,
          travel_min: r.slot.travelMin,
          weather: {
            temp_c: r.slot.hour.tempC,
            feels_like_c: r.slot.hour.feelsLikeC,
            wind_kph: r.slot.hour.windKph,
            gust_kph: r.slot.hour.gustKph,
            precip_prob: r.slot.hour.precipProb,
            precip_mm: r.slot.hour.precipMm,
            uv_index: r.slot.hour.uvIndex,
            humidity: r.slot.hour.humidity,
            visibility_m: r.slot.hour.visibilityM,
            weather_code: r.slot.hour.weatherCode,
            daylight: r.slot.hour.apparentDaylight,
            summary: r.slot.weatherSummary,
          },
          air_quality: r.slot.aq
            ? {
                european_aqi: r.slot.aq.europeanAqi,
                pm25: r.slot.aq.pm25,
                pm10: r.slot.aq.pm10,
              }
            : null,
          blockers: r.slot.blockers,
          reasons: r.slot.reasons,
          advice: r.advice,
          rationale: r.rationale,
          personal_note: r.personalNote,
        })),
        notes: reasoned.notes,
        citations: reasoned.citations,
      },
      data_sources: DATA_SOURCES,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e: any) {
    console.error("[assistant] error", e);
    return NextResponse.json(
      {
        error: "internal_error",
        message: e?.message ?? String(e),
        elapsed_ms: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}

// Simple health endpoint on the same path with GET
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "geoai-outdoor-assistant",
    version: "1.0.0",
    slm: {
      model: SLM_MODEL,
      invocation: HF_TOKEN_AVAILABLE() ? "HF Inference API" : "template fallback",
    },
    data_sources: DATA_SOURCES,
    endpoints: {
      "POST /api/assistant": "submit a free-form outdoor question",
      "GET  /api/assistant": "this health check",
    },
    example: {
      question: "Where can I go running tomorrow evening near Koregaon Park?",
    },
  });
}

function HF_TOKEN_AVAILABLE(): boolean {
  return !!(process.env.HF_TOKEN && process.env.HF_TOKEN.length > 0);
}
