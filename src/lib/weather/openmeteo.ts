/**
 * Open-Meteo — weather forecast + air quality + elevation.
 * Free, no API key. Docs:
 *   Forecast:   https://open-meteo.com/en/docs
 *   Air quality:https://open-meteo.com/en/docs/air-quality-api
 *   Geocoding:  https://open-meteo.com/en/docs/geocoding-api
 */

export interface HourlyForecast {
  time: string;            // ISO 8601
  timeMs: number;
  tempC: number;
  feelsLikeC: number;
  precipProb: number;      // %
  precipMm: number;
  windKph: number;
  windDir: number;         // degrees, meteorological
  gustKph: number;
  cloudCover: number;      // %
  uvIndex: number;
  humidity: number;        // %
  visibilityM: number;
  weatherCode: number;     // WMO code
  apparentDaylight: boolean;
}

export interface DayForecast {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipSumMm: number;
  precipProbMax: number;
  windMaxKph: number;
  uvIndexMax: number;
  sunriseMs: number;
  sunsetMs: number;
  weatherCode: number;
}

export interface AirQualityHour {
  time: string;
  timeMs: number;
  pm10: number;
  pm25: number;
  europeanAqi: number;       // European AQI 0..100+
  usAqi: number;            // US EPA AQI (computed approximation)
}

export interface ForecastBundle {
  hourly: HourlyForecast[];
  daily: DayForecast[];
  aq: AirQualityHour[];
  elevationM: number;
  fetchedAt: number;
}

// Cache: location-key → bundle. 30 min TTL.
const cache = new Map<string, { value: ForecastBundle; ts: number }>();
const TTL = 30 * 60 * 1000;

const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "uv_index",
  "relative_humidity_2m",
  "visibility",
  "weather_code",
  "is_day",
];
const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "uv_index_max",
  "sunrise",
  "sunset",
  "weather_code",
];
const AQ_VARS = [
  "pm10",
  "pm2_5",
  "european_aqi",
  "us_aqi",
];

export async function fetchForecast(
  lat: number, lon: number,
  daysAhead = 3
): Promise<ForecastBundle | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${daysAhead}`;
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.value;

  const tz = "Asia/Kolkata"; // sensible default for Indian users
  const hourly = HOURLY_VARS.join(",");
  const daily = DAILY_VARS.join(",");
  const fcastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourly}&daily=${daily}&timezone=${tz}&forecast_days=${daysAhead}&past_days=0`;

  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=${AQ_VARS.join(",")}&timezone=${tz}&forecast_days=${daysAhead}`;

  try {
    const [fr, ar] = await Promise.all([
      fetch(fcastUrl, { next: { revalidate: 1800 } }),
      fetch(aqUrl, { next: { revalidate: 1800 } }),
    ]);
    if (!fr.ok) {
      console.warn("[openmeteo] forecast non-OK", fr.status);
      return null;
    }
    const fj = await fr.json();
    const hourlyArr: HourlyForecast[] = buildHourly(fj.hourly);
    const dailyArr: DayForecast[] = buildDaily(fj.daily);
    let aqArr: AirQualityHour[] = [];
    if (ar.ok) {
      const aj = await ar.json();
      aqArr = buildAq(aj.hourly);
    }

    const bundle: ForecastBundle = {
      hourly: hourlyArr,
      daily: dailyArr,
      aq: aqArr,
      elevationM: fj.elevation ?? 0,
      fetchedAt: Date.now(),
    };
    cache.set(key, { value: bundle, ts: Date.now() });
    return bundle;
  } catch (e) {
    console.error("[openmeteo] error", e);
    return null;
  }
}

function buildHourly(h: any): HourlyForecast[] {
  if (!h || !h.time) return [];
  const out: HourlyForecast[] = [];
  for (let i = 0; i < h.time.length; i++) {
    out.push({
      time: h.time[i],
      timeMs: Date.parse(h.time[i]),
      tempC: n(h.temperature_2m?.[i]),
      feelsLikeC: n(h.apparent_temperature?.[i]),
      precipProb: n(h.precipitation_probability?.[i]),
      precipMm: n(h.precipitation?.[i]),
      windKph: n(h.wind_speed_10m?.[i]),
      windDir: n(h.wind_direction_10m?.[i]),
      gustKph: n(h.wind_gusts_10m?.[i]),
      cloudCover: n(h.cloud_cover?.[i]),
      uvIndex: n(h.uv_index?.[i]),
      humidity: n(h.relative_humidity_2m?.[i]),
      visibilityM: n(h.visibility?.[i]),
      weatherCode: n(h.weather_code?.[i]),
      apparentDaylight: h.is_day?.[i] === 1,
    });
  }
  return out;
}
function buildDaily(d: any): DayForecast[] {
  if (!d || !d.time) return [];
  const out: DayForecast[] = [];
  for (let i = 0; i < d.time.length; i++) {
    out.push({
      date: d.time[i],
      tempMaxC: n(d.temperature_2m_max?.[i]),
      tempMinC: n(d.temperature_2m_min?.[i]),
      precipSumMm: n(d.precipitation_sum?.[i]),
      precipProbMax: n(d.precipitation_probability_max?.[i]),
      windMaxKph: n(d.wind_speed_10m_max?.[i]),
      uvIndexMax: n(d.uv_index_max?.[i]),
      sunriseMs: d.sunrise?.[i] ? Date.parse(d.sunrise[i]) : 0,
      sunsetMs: d.sunset?.[i] ? Date.parse(d.sunset[i]) : 0,
      weatherCode: n(d.weather_code?.[i]),
    });
  }
  return out;
}
function buildAq(h: any): AirQualityHour[] {
  if (!h || !h.time) return [];
  const out: AirQualityHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    out.push({
      time: h.time[i],
      timeMs: Date.parse(h.time[i]),
      pm10: n(h.pm10?.[i]),
      pm25: n(h.pm2_5?.[i]),
      europeanAqi: n(h.european_aqi?.[i]),
      usAqi: n(h.us_aqi?.[i]),
    });
  }
  return out;
}
function n(x: any): number {
  if (x === null || x === undefined || Number.isNaN(x)) return 0;
  return Number(x);
}

// Convert WMO weather code → short description.
// Refs: https://open-meteo.com/en/docs (WMO codes)
export function wmoDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1 || code === 2 || code === 3) return "Mainly clear / partly cloudy / overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "—";
}

// Returns the hourly entry whose time-slot index best matches a target Date.
export function findHourAt(
  hourly: HourlyForecast[],
  targetMs: number
): HourlyForecast | null {
  if (!hourly.length) return null;
  let best = hourly[0], bestDelta = Math.abs(hourly[0].timeMs - targetMs);
  for (const h of hourly) {
    const d = Math.abs(h.timeMs - targetMs);
    if (d < bestDelta) { best = h; bestDelta = d; }
  }
  return best;
}

// Best matching AQ hour
export function findAqAt(aq: AirQualityHour[], targetMs: number): AirQualityHour | null {
  if (!aq.length) return null;
  let best = aq[0], bestDelta = Math.abs(aq[0].timeMs - targetMs);
  for (const a of aq) {
    const d = Math.abs(a.timeMs - targetMs);
    if (d < bestDelta) { best = a; bestDelta = d; }
  }
  return best;
}
