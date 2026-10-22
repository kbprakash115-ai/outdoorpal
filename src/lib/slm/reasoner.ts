/**
 * Reasoner — the heart of the assistant.
 *
 * Given a parsed query, this module:
 *   1. Geocodes the user's location (Nominatim)
 *   2. Searches candidate venues via Overpass around that location for the
 *      requested activity (and a small fallback set so the user always has
 *      *some* choice)
 *   3. For each candidate venue:
 *        - Fetches hourly weather + AQ for that exact coordinate (Open-Meteo)
 *        - Fetches sunrise/sunset (Open-Meteo daily, already in forecast bundle)
 *        - Fetches geospatial context (industry, parks, water, arterial roads,
 *          power lines) via Overpass
 *        - Fetches travel time (OSRM) from origin to venue
 *   4. For each (venue, hour) pair inside the user's time window, scores it
 *      using the activity rule, with profile-based tightening.
 *   5. Returns the top N recommendations, each with:
 *        - venue, hour, score, key reasons, advisory block (carry/watch/avoid),
 *          and a list of citations pointing at the live data we used.
 *
 * All claims are tied to live data; nothing is hallucinated.
 */

import { geocode } from "@/lib/geo/nominatim";
import {
  findVenues, describeGeoContext, Venue, GeoContext, ActivityKind,
} from "@/lib/geo/overpass";
import { route, TravelInfo } from "@/lib/geo/osrm";
import {
  fetchForecast, findHourAt, findAqAt, HourlyForecast, ForecastBundle,
  AirQualityHour, wmoDescription,
} from "@/lib/weather/openmeteo";
import {
  ACTIVITY_RULES, adjustForProfile, PersonalProfile, ActivityRule,
} from "./activities";
import { ParsedQuery, ParsedTimeRange } from "./parser";

export interface ScoredSlot {
  venue: Venue;
  hour: HourlyForecast;
  aq: AirQualityHour | null;
  score: number;            // 0..100
  ok: boolean;              // passes hard limits?
  blockers: string[];       // list of issues that block the slot
  reasons: string[];        // why we picked / scored it this way
  weatherSummary: string;
  travelMin: number;        // 0 if unreachable
}

export interface Recommendation {
  rank: number;
  slot: ScoredSlot;
  rule: ActivityRule;
  advice: { carry: string[]; watch: string[]; avoid: string[] };
  citations: Citation[];
  rationale: string;        // 1-2 sentence rationale
  personalNote: string | null;
}

export interface Citation {
  label: string;
  source: string;          // human name of source
  url: string;             // canonical URL the user can verify
  value: string;           // the actual value we used
  fetchedAt: number;
}

export interface ReasonerOutput {
  query: ParsedQuery;
  origin: { lat: number; lon: number; name: string } | null;
  activity: ActivityKind;
  rule: ActivityRule;       // after profile adjustment
  profile: PersonalProfile;
  candidates: number;
  scored: number;
  recommendations: Recommendation[];
  fallbackUsed: boolean;
  citations: Citation[];    // aggregated
  notes: string[];
  elapsedMs: number;
}

const MAX_CANDIDATES = 4;       // we'll evaluate up to 4 venues (rate-limit friendly)
const MAX_RECOMMENDATIONS = 3;
const HARD_LIMIT_OK = true;

export async function reason(
  q: ParsedQuery
): Promise<ReasonerOutput> {
  const t0 = Date.now();
  const notes: string[] = [];
  const citations: Citation[] = [];

  // 1. Activity rule
  if (!q.activity) {
    return noActivity(q, t0, notes);
  }
  const baseRule = ACTIVITY_RULES[q.activity];
  const rule = adjustForProfile(baseRule, q.profile);
  if (q.profile.hasAsthma || q.profile.isSenior || q.profile.isChild || q.profile.isPregnant) {
    notes.push(`Personal profile detected — thresholds tightened (${profileText(q.profile)}).`);
  }

  // 2. Geocode
  if (!q.locationRaw) {
    return noLocation(q, baseRule, t0, notes);
  }
  const loc = await geocode(q.locationRaw);
  if (!loc) {
    notes.push(`Could not geocode "${q.locationRaw}" — try a more specific place name.`);
    return {
      query: q,
      origin: null,
      activity: q.activity,
      rule,
      profile: q.profile,
      candidates: 0,
      scored: 0,
      recommendations: [],
      fallbackUsed: false,
      citations,
      notes,
      elapsedMs: Date.now() - t0,
    };
  }
  citations.push({
    label: "Geocoding",
    source: "Nominatim / OpenStreetMap",
    url: `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q.locationRaw)}`,
    value: `${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)} (${loc.displayName})`,
    fetchedAt: Date.now(),
  });

  // 3. Search candidate venues
  const radiusM = Math.round(q.searchRadiusKm * 1000);
  let venues = await findVenues(loc.lat, loc.lon, radiusM, [q.activity]);
  let fallbackUsed = false;
  // If no venue found in the requested activity, fall back to parks (which work
  // for almost any soft outdoor activity).
  if (venues.length === 0) {
    fallbackUsed = true;
    notes.push(`No ${q.activity}-specific venues found in OSM within ${q.searchRadiusKm} km — falling back to nearby parks.`);
    venues = await findVenues(loc.lat, loc.lon, radiusM, ["picnic"]);
  }
  // Hard cap on candidates to stay rate-limit friendly
  venues = venues.slice(0, MAX_CANDIDATES);
  citations.push({
    label: "Venue search",
    source: "Overpass API / OpenStreetMap",
    url: "https://overpass-api.de/",
    value: `${venues.length} candidate venues within ${q.searchRadiusKm} km`,
    fetchedAt: Date.now(),
  });

  // 4. Score each (venue × hour) pair
  const slots: ScoredSlot[] = [];
  // Fetch weather + geospatial context + travel time IN PARALLEL per venue.
  // Iterates venues sequentially (to respect rate limits) but the 3 fetches
  // for each venue run concurrently.
  for (const v of venues) {
    const [fcast, ctx, travel] = await Promise.all([
      fetchForecast(v.lat, v.lon, 3),
      describeGeoContext(v.lat, v.lon, 1500),
      route(loc.lat, loc.lon, v.lat, v.lon),
    ]);
    if (!fcast) {
      notes.push(`Forecast unavailable for ${v.name} — skipping.`);
      continue;
    }
    citations.push({
      label: "Weather forecast",
      source: "Open-Meteo (forecast)",
      url: `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}`,
      value: `${fcast.hourly.length} hourly entries, ${fcast.daily.length} daily`,
      fetchedAt: fcast.fetchedAt,
    });
    citations.push({
      label: "Air quality forecast",
      source: "Open-Meteo (air quality)",
      url: `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${v.lat}&longitude=${v.lon}`,
      value: `${fcast.aq.length} hourly AQ entries`,
      fetchedAt: fcast.fetchedAt,
    });
    citations.push({
      label: "Geospatial context",
      source: "Overpass API / OpenStreetMap",
      url: "https://overpass-api.de/",
      value: `industry=${ctx.industryCount}, green=${ctx.greenCount}, water=${ctx.waterCount}, arterial roads=${ctx.arterialRoads}, power=${ctx.powerLineCount}`,
      fetchedAt: Date.now(),
    });
    if (travel.reachable) {
      citations.push({
        label: "Travel time",
        source: "OSRM (project-osrm.org)",
        url: "https://router.project-osrm.org/",
        value: `${travel.durationMin} min by car, ${(travel.distanceM / 1000).toFixed(1)} km`,
        fetchedAt: Date.now(),
      });
    }

    // Score each candidate hour inside the time window
    for (const h of fcast.hourly) {
      if (!q.time || (h.timeMs >= q.time.startMs && h.timeMs <= q.time.endMs)) {
        const aq = findAqAt(fcast.aq, h.timeMs);
        const s = scoreSlot(v, h, aq, ctx, travel, rule, q.profile);
        slots.push(s);
      }
    }
  }

  // 5. Sort: highest-scoring slots first
  slots.sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || b.score - a.score);

  // 6. Build top-N recommendations, deduplicating on venue
  const recs: Recommendation[] = [];
  const seenVenue = new Set<string>();
  for (const s of slots) {
    if (seenVenue.has(s.venue.id)) continue;
    if (recs.length >= MAX_RECOMMENDATIONS) break;
    seenVenue.add(s.venue.id);
    const slotCitations = buildSlotCitations(s, rule);
    recs.push({
      rank: recs.length + 1,
      slot: s,
      rule,
      advice: {
        carry: rule.advice.carry,
        watch: rule.advice.watch,
        avoid: rule.avoid,
      },
      citations: slotCitations,
      rationale: rationaleFor(s, rule),
      personalNote: personalNoteFor(q.profile, rule),
    });
  }

  return {
    query: q,
    origin: { lat: loc.lat, lon: loc.lon, name: loc.displayName },
    activity: q.activity,
    rule,
    profile: q.profile,
    candidates: venues.length,
    scored: slots.length,
    recommendations: recs,
    fallbackUsed,
    citations,
    notes,
    elapsedMs: Date.now() - t0,
  };
}

// -----------------------------------------------------------------------------
// Scoring
// -----------------------------------------------------------------------------

function scoreSlot(
  v: Venue,
  h: HourlyForecast,
  aq: AirQualityHour | null,
  ctx: GeoContext,
  travel: TravelInfo,
  rule: ActivityRule,
  profile: PersonalProfile
): ScoredSlot {
  const blockers: string[] = [];
  const reasons: string[] = [];

  // Temperature
  if (h.feelsLikeC < rule.tempMin) blockers.push(`apparent ${h.feelsLikeC}°C below min ${rule.tempMin}°C`);
  else if (h.feelsLikeC > rule.tempMax) blockers.push(`apparent ${h.feelsLikeC}°C above max ${rule.tempMax}°C`);
  else if (h.feelsLikeC >= rule.idealTemp[0] && h.feelsLikeC <= rule.idealTemp[1]) {
    reasons.push(`feels-like ${h.feelsLikeC}°C is in the ideal range`);
  } else {
    reasons.push(`feels-like ${h.feelsLikeC}°C is acceptable but not ideal`);
  }

  // Wind / gusts
  if (h.windKph > rule.maxWindKph) blockers.push(`wind ${h.windKph} kph > limit ${rule.maxWindKph}`);
  else if (h.gustKph > rule.maxGustKph) blockers.push(`gusts ${h.gustKph} kph > limit ${rule.maxGustKph}`);
  else if (h.windKph <= 12) reasons.push(`light wind (${h.windKph} kph)`);

  // Precipitation
  if (h.precipProb > rule.maxPrecipProb) blockers.push(`rain prob ${h.precipProb}% > limit ${rule.maxPrecipProb}%`);
  else if (h.precipMm > rule.maxPrecipMm) blockers.push(`rain ${h.precipMm} mm > limit ${rule.maxPrecipMm} mm`);
  else if (h.precipProb <= 10) reasons.push(`rain probability ${h.precipProb}%`);

  // UV
  if (h.uvIndex > rule.maxUvIndex) blockers.push(`UV ${h.uvIndex} > limit ${rule.maxUvIndex}`);
  else if (h.uvIndex >= 6) reasons.push(`UV ${h.uvIndex} — wear SPF`);

  // Visibility
  if (h.visibilityM > 0 && h.visibilityM < rule.minVisibilityM) {
    blockers.push(`visibility ${h.visibilityM} m below min ${rule.minVisibilityM} m`);
  }

  // Daylight
  if (rule.requiresDaylight && !h.apparentDaylight) {
    blockers.push("activity requires daylight — sun has set");
  } else if (rule.idealDaylight && h.apparentDaylight) {
    reasons.push("daylight available");
  }

  // Air quality (European AQI 0..100)
  if (aq && aq.europeanAqi > rule.maxAqiEuropean) {
    blockers.push(`AQI ${aq.europeanAqi} > limit ${rule.maxAqiEuropean}`);
  } else if (aq && aq.europeanAqi <= 20) {
    reasons.push(`good air quality (AQI ${aq.europeanAqi})`);
  } else if (aq && aq.pm25 > 0) {
    reasons.push(`PM2.5 ${aq.pm25} µg/m³, AQI ${aq.europeanAqi}`);
  }

  // Humidity
  if (h.humidity > rule.maxHumidity) blockers.push(`humidity ${h.humidity}% > limit ${rule.maxHumidity}%`);
  else if (h.humidity < rule.minHumidity) blockers.push(`humidity ${h.humidity}% below min ${rule.minHumidity}%`);

  // Geospatial
  if (ctx.industryCount > rule.maxIndustryCount) {
    blockers.push(`${ctx.industryCount} industrial sites within 1.5 km (air quality risk)`);
  }
  if (ctx.arterialRoads > rule.maxArterialRoads) {
    blockers.push(`${ctx.arterialRoads} arterial roads within 1.5 km`);
  }
  if (ctx.greenCount >= rule.minGreenCount) {
    reasons.push(`${ctx.greenCount} green spaces nearby`);
  }
  if (ctx.waterCount > 0) {
    reasons.push(`${ctx.waterCount} water body nearby`);
  }

  // Travel
  let travelMin = 0;
  if (travel.reachable) {
    travelMin = travel.durationMin;
    if (travel.durationMin > 90) {
      blockers.push(`travel time ${travel.durationMin} min — too far for a quick outing`);
    } else if (travel.durationMin <= 30) {
      reasons.push(`${travel.durationMin} min by road`);
    }
  } else {
    reasons.push("road routing unavailable");
  }

  // Score: start from 100, subtract penalties, add bonuses
  let score = 50; // neutral
  if (blockers.length === 0) {
    score = 70;
    // Bonuses for ideal conditions
    if (h.feelsLikeC >= rule.idealTemp[0] && h.feelsLikeC <= rule.idealTemp[1]) score += 8;
    if (h.windKph <= 12) score += 5;
    if (h.precipProb <= 10) score += 5;
    if (aq && aq.europeanAqi <= 20) score += 5;
    if (ctx.greenCount >= 2) score += 5;
    if (travel.reachable && travel.durationMin <= 30) score += 5;
    if (rule.idealDaylight && h.apparentDaylight) score += 5;
    // small evening-hour preference for photography (golden hour)
    if (rule.key === "photography") {
      const hr = new Date(h.timeMs).getUTCHours();
      if (hr >= 5 && hr <= 8) score += 3;
      if (hr >= 16 && hr <= 19) score += 5;
    }
    score = Math.min(100, score);
  } else {
    // Still assign a low score for ranking blocked options last
    score = Math.max(5, 40 - blockers.length * 5);
  }

  const ok = blockers.length === 0;
  const weatherSummary = weatherSummaryFor(h, aq);

  return {
    venue: v, hour: h, aq,
    score, ok, blockers, reasons,
    weatherSummary, travelMin,
  };
}

function weatherSummaryFor(h: HourlyForecast, aq: AirQualityHour | null): string {
  const parts: string[] = [];
  parts.push(`${h.feelsLikeC}°C (feels-like)`);
  parts.push(`${h.windKph} kph wind${h.gustKph > h.windKph + 5 ? `, gusts ${h.gustKph}` : ""}`);
  parts.push(`${h.precipProb}% rain`);
  if (h.uvIndex >= 6) parts.push(`UV ${h.uvIndex}`);
  if (aq) parts.push(`AQI ${aq.europeanAqi}, PM2.5 ${aq.pm25.toFixed(0)}`);
  parts.push(wmoDescription(h.weatherCode));
  return parts.join(" · ");
}

function rationaleFor(s: ScoredSlot, r: ActivityRule): string {
  const time = new Date(s.hour.timeMs).toLocaleString("en-IN", {
    weekday: "short", hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "Asia/Kolkata",
  });
  const reasons = s.reasons.slice(0, 3).join("; ");
  return `Best slot: ${s.venue.name} around ${time}. ${reasons}. ${s.travelMin > 0 ? `About ${s.travelMin} min by road from origin.` : "Travel time unavailable."}`;
}

function personalNoteFor(p: PersonalProfile, r: ActivityRule): string | null {
  if (p.hasAsthma) return `You mentioned mild asthma — I tightened the AQI ceiling to ${r.maxAqiEuropean} (European AQI). Carry your inhaler; avoid cold, dry, windy early mornings.`;
  if (p.isSenior) return `Adjusted for senior comfort: temperature ${r.tempMin}–${r.tempMax}°C, wind cap ${r.maxWindKph} kph, AQI cap ${r.maxAqiEuropean}.`;
  if (p.isChild) return `Adjusted for a child: stricter UV (≤${r.maxUvIndex}), AQI ≤ ${r.maxAqiEuropean}, temp ${r.tempMin}–${r.tempMax}°C.`;
  if (p.isPregnant) return `Adjusted for pregnancy: heat cap ${r.tempMax}°C, UV ≤ ${r.maxUvIndex}, AQI ≤ ${r.maxAqiEuropean}. Stay hydrated.`;
  return null;
}

function buildSlotCitations(s: ScoredSlot, rule: ActivityRule): Citation[] {
  const out: Citation[] = [];
  out.push({
    label: "Venue",
    source: "OpenStreetMap (via Overpass)",
    url: `https://www.openstreetmap.org/?mlat=${s.venue.lat}&mlon=${s.venue.lon}#map=16/${s.venue.lat}/${s.venue.lon}`,
    value: `${s.venue.name} (${s.venue.type}) at ${s.venue.lat.toFixed(4)}, ${s.venue.lon.toFixed(4)}`,
    fetchedAt: Date.now(),
  });
  out.push({
    label: "Hourly weather at slot",
    source: "Open-Meteo",
    url: `https://api.open-meteo.com/v1/forecast?latitude=${s.venue.lat}&longitude=${s.venue.lon}&hourly=temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,wind_gusts_10m,uv_index,weather_code,is_day`,
    value: s.weatherSummary,
    fetchedAt: Date.now(),
  });
  if (s.aq) {
    out.push({
      label: "Air quality at slot",
      source: "Open-Meteo (air quality)",
      url: `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${s.venue.lat}&longitude=${s.venue.lon}&hourly=pm10,pm2_5,european_aqi`,
      value: `European AQI ${s.aq.europeanAqi}, PM2.5 ${s.aq.pm25.toFixed(1)} µg/m³, PM10 ${s.aq.pm10.toFixed(1)} µg/m³`,
      fetchedAt: Date.now(),
    });
  }
  if (s.travelMin > 0) {
    out.push({
      label: "Road routing",
      source: "OSRM",
      url: "https://router.project-osrm.org/",
      value: `${s.travelMin} min by car from origin`,
      fetchedAt: Date.now(),
    });
  }
  out.push({
    label: "Activity rule",
    source: "GeoAI assistant rule-book",
    url: "https://github.com/geoai-hackathon/outdoor-assistant",
    value: `temp ${rule.tempMin}–${rule.tempMax}°C, wind ≤${rule.maxWindKph} kph, AQI ≤${rule.maxAqiEuropean}, daylight=${rule.requiresDaylight}`,
    fetchedAt: Date.now(),
  });
  return out;
}

function profileText(p: PersonalProfile): string {
  const parts: string[] = [];
  if (p.hasAsthma) parts.push("asthma");
  if (p.isSenior) parts.push("senior");
  if (p.isChild) parts.push("child");
  if (p.isPregnant) parts.push("pregnancy");
  return parts.join(", ") || "none";
}

function noActivity(q: ParsedQuery, t0: number, notes: string[]): ReasonerOutput {
  return {
    query: q,
    origin: null,
    activity: "picnic" as ActivityKind,
    rule: ACTIVITY_RULES.picnic,
    profile: q.profile,
    candidates: 0, scored: 0,
    recommendations: [],
    fallbackUsed: false,
    citations: [],
    notes: [...notes, "Activity could not be parsed from the question."],
    elapsedMs: Date.now() - t0,
  };
}
function noLocation(q: ParsedQuery, rule: ActivityRule, t0: number, notes: string[]): ReasonerOutput {
  return {
    query: q,
    origin: null,
    activity: q.activity!,
    rule,
    profile: q.profile,
    candidates: 0, scored: 0,
    recommendations: [],
    fallbackUsed: false,
    citations: [],
    notes: [...notes, "No location given — cannot search venues."],
    elapsedMs: Date.now() - t0,
  };
}
