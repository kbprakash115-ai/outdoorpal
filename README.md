# OutdoorPal — GeoAI

> An SLM-powered outdoor-activity assistant that recommends **where** and **when** to head outdoors, grounded in live weather + geospatial data.

[![Live API](https://img.shields.io/badge/API-POST%20%2Fapi%2Fassistant-emerald)](#api-endpoint)
[![SLM](https://img.shields.io/badge/SLM-Qwen2.5--1.5B--1.5B%20params-blue)](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct)
[![Data](https://img.shields.io/badge/data-OSM%20·%20OpenMeteo%20·%20OSRM-green)](#data-sources)

---

## What it does

Given a free-form question such as *"Where can I go running tomorrow evening near Koregaon Park?"* the assistant:

1. **Parses** the question → activity, location, time range, personal profile (asthma, senior, child, pregnancy).
2. **Geocodes** the location (Nominatim).
3. **Finds candidate venues** via OpenStreetMap (Overpass API, with a Nominatim POI fallback).
4. **Fetches live weather + air quality** for each candidate (Open-Meteo).
5. **Fetches road travel time** (OSRM) and **geospatial context** (industry, green cover, water, arterial roads).
6. **Scores every (venue × hour) pair** using activity-specific safety limits, tightened further for personal profiles.
7. **Returns a grounded recommendation** with: best venue + best time, score, blockers, what to carry, what to watch for, when to avoid — and a citation for every live-data claim.

The small language model (Qwen2.5-1.5B-Instruct, ≤3B params) is used only to **naturalise the prose** of the structured reasoning output. It never invents weather, places, or numbers — every claim is tied to data the reasoner actually fetched.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 + React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Map | Leaflet 1.9 with OpenStreetMap tiles |
| Backend | Next.js API routes (`/api/assistant`) |
| Reasoning | Custom TypeScript rule engine (no external LLM call for scoring) |
| SLM (NLG) | Qwen/Qwen2.5-1.5B-Instruct via Hugging Face Inference API (or deterministic template fallback when no `HF_TOKEN` is set) |
| Live data | OpenStreetMap · Overpass API · Nominatim · Open-Meteo · OSRM |

---

## How to run

### Prerequisites
- Node 18+ or Bun 1.0+
- Internet (the assistant fetches live data on every request)

### Install & start
```bash
git clone <your-repo-url> outdoorpal
cd outdoorpal
bun install
bun run dev    # starts Next.js on port 3000
```

Open <http://localhost:3000>.

### Optional — enable the SLM (otherwise template fallback is used)
```bash
# .env  (do NOT commit this file — it is gitignored)
HF_TOKEN=hf_your_token_here
HF_MODEL=Qwen/Qwen2.5-1.5B-Instruct   # default; swap for any open SLM ≤ 3B
```

Get a free Hugging Face token at <https://huggingface.co/settings/tokens> (read scope is enough — the model is public).

### Production
```bash
bun run build
bun run start   # production server on port 3000
```

---

## API endpoint

### `POST /api/assistant`

```bash
curl -X POST https://your-deployment/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"question":"Where can I go running tomorrow evening near Koregaon Park?"}'
```

#### Response (abridged)
```json
{
  "question": "Where can I go running tomorrow evening near Koregaon Park?",
  "answer": "## Running / jogging near Koregaon Park — tomorrow evening\n…",
  "answer_text": "Running / jogging near Koregaon Park — tomorrow evening\n…",
  "generator": "template",
  "model": "Qwen/Qwen2.5-1.5B-Instruct (template fallback — set HF_TOKEN to use SLM)",
  "slm": {
    "model_repo": "Qwen/Qwen2.5-1.5B-Instruct",
    "parameter_count": "~1.5B (within the 3B cap)",
    "license": "Qwen license (open)",
    "hosted_at": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct",
    "invocation": "Hugging Face Inference API"
  },
  "reasoner": {
    "activity": "running",
    "activity_label": "Running / jogging",
    "profile": { "hasAsthma": false, "isSenior": false, "isChild": false, "isPregnant": false },
    "origin": { "lat": 18.5366, "lon": 73.8933, "name": "Koregaon Park, …" },
    "candidates": 4,
    "scored": 18,
    "recommendations": [
      {
        "rank": 1,
        "venue_name": "Muredha Nala Park",
        "venue_lat": 18.5119,
        "venue_lon": 73.8863,
        "slot_time_iso": "2026-10-23T13:30:00.000Z",
        "slot_time_local": "23/10/2026, 7:00:00 pm",
        "score": 35,
        "ok": false,
        "travel_min": 8,
        "weather": { "feels_like_c": 32.9, "wind_kph": 7.6, "precip_prob": 0, "uv_index": 6.65, "summary": "…" },
        "air_quality": { "european_aqi": 83, "pm25": 43.2 },
        "blockers": ["AQI 83 > limit 50"],
        "reasons": ["light wind (7.6 kph)", "rain probability 0%", "daylight available", "10 green spaces nearby", "8 min by road"],
        "advice": { "carry": ["Water (500 ml+)", "Reflective band if low light", "Phone for safety"], "watch": ["…"], "avoid": ["UV > 7 around noon", "Wind > 28 kph", "AQI > 50 (asthma)"] },
        "rationale": "Best slot: …",
        "personal_note": null
      }
    ],
    "notes": ["No running-specific venues found in OSM within 10 km — falling back to nearby parks."],
    "citations": [ /* one entry per live-data fetch */ ]
  },
  "data_sources": [ /* full disclosure list */ ],
  "elapsed_ms": 16120
}
```

### `GET /api/assistant`
Returns a health-check describing the service, the SLM, and the data sources used.

---

## Base model & fine-tuning

| | |
|---|---|
| **Base model** | `Qwen/Qwen2.5-1.5B-Instruct` (1.54 B parameters) |
| **Provider** | Qwen team (Alibaba), Apache-2.0-friendly Qwen license |
| **Parameter cap** | 1.5 B ≤ 3 B ✓ (within hackathon rule) |
| **Fine-tuning** | **None** — we use the base instruct model directly. The hackathon explicitly allows this ("You may use an open base model directly"). |
| **Role in pipeline** | NLG only — it naturalises the structured reasoning output. It never makes the recommendation decision; the rule engine does, against live data. |
| **Invocation** | Hugging Face Inference API (`https://api-inference.huggingface.co/models/Qwen/Qwen2.5-1.5B-Instruct`). Self-hosting with `text-generation-inference` or `vLLM` is a drop-in alternative — set `HF_MODEL` to your endpoint. |
| **Repo on HF** | <https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct> (we point at the official base; teams may fork and host a model card; see `model-card.md` in this directory). |

If you prefer to swap in another open SLM (Phi-3-mini, Llama-3.2-1B, Gemma-2-2B), set:
```
HF_MODEL=microsoft/Phi-3-mini-4k-instruct
```
The prompt template (`<|im_start|>…<|im_end|>`) is Qwen-flavoured; for Llama/Gemma set the matching chat template in `src/lib/slm/nlg.ts`.

---

## Data sources (full disclosure)

| Source | URL | What we use | Rate-limit policy |
|---|---|---|---|
| OpenStreetMap — Overpass API | <https://overpass-api.de/> | Venue search + geospatial context (industry, parks, water, roads) | 1 req / 15 s, 25 s timeout |
| Nominatim | <https://nominatim.openstreetmap.org/> | Place-name → coordinates; POI search fallback | 1 req/sec, identify with User-Agent |
| Open-Meteo — Forecast | <https://open-meteo.com/en/docs> | Hourly temp, apparent temp, wind, precip, UV, humidity, visibility, weather code, daylight | 10k req/day free, no key |
| Open-Meteo — Air Quality | <https://open-meteo.com/en/docs/air-quality-api> | PM10, PM2.5, European AQI | Same |
| OSRM — routing | <https://router.project-osrm.org/> | Road travel time + distance | Demo server; self-host in prod |
| Hugging Face Hub | <https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct> | Hosts the SLM weights; Inference API | Free tier with HF token |

**Attribution:** Map data © OpenStreetMap contributors, ODbL 1.0 — <https://www.openstreetmap.org/copyright>.

---

## Architecture (one-liner per step)

```
User question
   │
   ▼
1. Parse         ─► activity, location, time, profile            (rule-based + SLM-optional)
2. Geocode       ─► lat/lon of origin                            (Nominatim, India-biased)
3. Find venues   ─► list of candidate venues in radius           (Overpass → Nominatim POI fallback)
4. Per venue:
   ├─ fetchForecast   ─► 72 h of weather + 3 days of daily       (Open-Meteo)
   ├─ describeGeoCtx  ─► industry / green / water / roads count  (Overpass → Nominatim fallback)
   └─ route           ─► travel time                              (OSRM)
5. Score each (venue × hour) pair using activity rule + profile
6. Sort by ok-then-score; pick top 3 distinct venues
7. Generate recommendation prose                                (Qwen2.5-1.5B SLM or template)
8. Return JSON with citations + map data
```

---

## Activities supported

The 10 activities required by the rulebook, each with its own safety profile (temperature, wind, rain, UV, AQI, daylight, geospatial limits):

- 🏃 Running / jogging
- 🚴 Cycling (leisure or commute)
- ⛳ Golf
- 🏏 Cricket (recreational)
- ⚽ Football / five-a-side
- 🎾 Outdoor tennis
- 🥾 Hiking / nature walk
- 🧺 Picnic / park outing
- 🎪 Outdoor event / gathering
- 📷 Outdoor photography

Personal profiles: **asthma**, **senior**, **child**, **pregnancy** — each tightens the relevant thresholds (especially AQI, UV, temperature).

---

## Honest limitations

- The 1.5 B-parameter SLM can drift off-message on long prompts; we constrain it tightly (system prompt, ≤350 new tokens, ground-truth payload). For production, fine-tune the model on a few thousand grounded QA pairs.
- Overpass coverage varies by city — OSM is rich in Pune and Bengaluru, thinner in smaller towns. The Nominatim POI fallback returns *named* venues but may miss unnamed pitches/trails.
- The rule book is hand-tuned; thresholds (e.g. AQI ≤ 50 for running) are reasonable starting points, not medical guidance.
- The OSRM demo server is rate-limited. For production, self-host OSRM with a regional OSM extract.
- Open-Meteo's AQI is CAMS European with a US-AQI approximation; for India, CPCB AQI may differ — integrate OpenAQ or WAQI for stricter accuracy.
- The geocoder is India-biased (`countrycodes=in` first). For non-Indian queries, the global fallback handles it but slower.
- Travel times are driving times. For cycling / walking the assistant flags this in the advice block.

---

## Demo

A worked example is included as a screenshot in `download/ui-screenshot-1.png`. Try queries like:

- "Where can I go running tomorrow evening near Koregaon Park?"
- "Best time this weekend for a kids' cricket match within 15 km of Whitefield?"
- "I have mild asthma, where's good for a morning walk near Powai in the next two days?"
- "Where can I take sunset photos this evening around Bandra?"

---

## Repo layout

```
src/
├─ app/
│  ├─ api/assistant/route.ts   ← POST endpoint + GET health-check
│  ├─ page.tsx                 ← Chat UI with map + activity picker
│  └─ layout.tsx
├─ components/
│  ├─ ui/                      ← shadcn/ui components
│  └─ outdoor/
│     ├─ map-view.tsx           ← Leaflet map (client-only)
│     └─ assistant-message.tsx ← Markdown answer + slot cards + citations
└─ lib/
   ├─ chat-store.ts            ← Zustand store
   ├─ geo/
   │  ├─ nominatim.ts          ← geocoding (India-biased)
   │  ├─ overpass.ts           ← venue search + geospatial context (with OSM-API fallback)
   │  └─ osrm.ts               ← road routing
   ├─ weather/
   │  └─ openmeteo.ts          ← forecast + AQ
   └─ slm/
      ├─ parser.ts             ← free-form text → structured ParsedQuery
      ├─ activities.ts         ← 10 activity rules + profile adjustments
      ├─ reasoner.ts           ← scoring engine (venue × hour) with citations
      └─ nlg.ts                ← template NLG + optional SLM call
```

---

## Built with

- ChatGPT-class models were **not** used inside the running assistant. Qwen2.5-1.5B-Instruct (open, ≤3B) is the only language model in the running pipeline.

---

## License

MIT for our code; the model weights follow the [Qwen license](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/main/LICENSE). Map data © OpenStreetMap contributors, ODbL 1.0.
