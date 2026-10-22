/**
 * Overpass API — OpenStreetMap venue search.
 * Source: https://overpass-api.de/  (also: https://wiki.openstreetmap.org/wiki/Overpass_API)
 * © OpenStreetMap contributors
 *
 * We use Overpass to find candidate outdoor activity venues (parks,
 * sport pitches, running tracks, golf courses, picnic sites, etc.)
 * within a search radius around a center point.
 */

export interface Venue {
  id: number;
  name: string;
  type: string;            // park, pitch, track, golf_course, ...
  category: ActivityKind;  // which activity(s) this venue suits
  lat: number;
  lon: number;
  tags: Record<string, string>;
  distanceM: number;       // straight-line distance from center (m)
}

export type ActivityKind =
  | "running"
  | "cycling"
  | "golf"
  | "cricket"
  | "football"
  | "tennis"
  | "hiking"
  | "picnic"
  | "event"
  | "photography";

// Overpass QL selector per activity (one of these OR-combined in the query).
// Picked to be reasonably small in response size while covering the spirit of each activity.
const VENUE_SELECTOR: Record<ActivityKind, string[]> = {
  running: [
    'nwr["leisure"="track"]["sport"~"running|athletics"]',
    'nwr["highway"="footway"]["footway"="trail"]',
    'nwr["route"="running"]',
  ],
  cycling: [
    'nwr["highway"="cycleway"]',
    'nwr["route"="bicycle"]',
    'nwr["cycleway"]',
  ],
  golf: ['nwr["leisure"="golf_course"]', 'nwr["sport"="golf"]'],
  cricket: [
    'nwr["leisure"="pitch"]["sport"~"cricket"]',
    'nwr["sport"="cricket"]',
  ],
  football: [
    'nwr["leisure"="pitch"]["sport"~"soccer|football"]',
    'nwr["sport"="soccer"]',
  ],
  tennis: ['nwr["leisure"="pitch"]["sport"="tennis"]', 'nwr["sport"="tennis"]'],
  hiking: [
    'nwr["highway"="path"]',
    'nwr["route"="hiking"]',
    'nwr["tourism"="camp_site"]',
  ],
  picnic: [
    'nwr["leisure"="park"]',
    'nwr["leisure"="garden"]',
    'nwr["tourism"="picnic_site"]',
    'nwr["leisure"="picnic_table"]',
  ],
  event: [
    'nwr["leisure"="park"]',
    'nwr["amenity"="events_venue"]',
    'nwr["tourism"="attraction"]',
  ],
  photography: [
    'nwr["tourism"="viewpoint"]',
    'nwr["water"="lake"]',
    'nwr["natural"="beach"]',
    'nwr["natural"="peak"]',
    'nwr["historic"="monument"]',
  ],
};

// Reverse-map: given an Overpass element, decide which activities it suits.
function classifyElement(tags: Record<string, string>): ActivityKind[] {
  const acts: ActivityKind[] = [];
  const leisure = tags.leisure;
  const sport = tags.sport;
  const highway = tags.highway;
  const route = tags.route;
  const tourism = tags.tourism;
  const natural = tags.natural;

  if (sport === "running" || sport === "athletics" || (leisure === "track" && (sport === "" || sport === undefined))) acts.push("running");
  if (highway === "footway" && tags.footway === "trail") acts.push("running");
  if (highway === "cycleway" || route === "bicycle" || tags.cycleway) acts.push("cycling");
  if (leisure === "golf_course" || sport === "golf") acts.push("golf");
  if (sport === "cricket") acts.push("cricket");
  if (sport === "soccer" || sport === "football") acts.push("football");
  if (sport === "tennis") acts.push("tennis");
  if (highway === "path" || route === "hiking" || tourism === "camp_site") acts.push("hiking");
  if (leisure === "park" || leisure === "garden" || tourism === "picnic_site" || tags.picnic_table) acts.push("picnic");
  if (leisure === "park" || amenityEvents(tags) || tourism === "attraction") acts.push("event");
  if (tourism === "viewpoint" || tags.water === "lake" || natural === "beach" || natural === "peak" || tags.historic === "monument") acts.push("photography");
  return acts;
}
function amenityEvents(tags: Record<string, string>): boolean {
  return tags.amenity === "events_venue" || tags.amenity === "community_centre";
}

function haversineM(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const cache = new Map<string, { value: Venue[]; ts: number }>();
const TTL = 30 * 60 * 1000; // 30 min cache

export async function findVenues(
  centerLat: number,
  centerLon: number,
  radiusM: number,
  activities: ActivityKind[]
): Promise<Venue[]> {
  if (activities.length === 0) return [];
  // Cap radius to avoid absurdly large Overpass queries
  const r = Math.min(Math.max(radiusM, 1500), 60000);
  // Cap Overpass query size
  const acts = Array.from(new Set(activities));
  const selectors = acts
    .flatMap((a) => VENUE_SELECTOR[a] ?? [])
    .map((s) => `${s}(around:${r},${centerLat},${centerLon});`)
    .join("");

  const cacheKey = `${centerLat.toFixed(4)},${centerLon.toFixed(4)},${r},${acts.join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.value;

  const q = `[out:json][timeout:25];(${selectors});out center tags 80;`;

  // 1. Try the main Overpass endpoint
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Accept: "application/json" },
      body: q,
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const j = await res.json();
      const venues = parseOverpass(j, centerLat, centerLon, cacheKey);
      if (venues.length > 0) return venues;
      // fall through to fallback if 0 venues
    }
  } catch (e) {
    console.warn("[overpass] primary failed:", e instanceof Error ? e.message : String(e));
  }

  // 2. Try the Kumi mirror
  try {
    const alt = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Accept: "application/json" },
      body: q,
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(15000),
    });
    if (alt.ok) {
      const j = await alt.json();
      const venues = parseOverpass(j, centerLat, centerLon, cacheKey);
      if (venues.length > 0) return venues;
    }
  } catch (e) {
    console.warn("[overpass] kumi mirror failed:", e instanceof Error ? e.message : String(e));
  }

  // 3. Fallback: Nominatim POI search within viewbox.
  // Used when all Overpass endpoints are unreachable. Nominatim supports a
  // text query + viewbox + bounded=1 that returns named POIs (parks, sport
  // grounds, etc.) within a rectangular area. We run a small keyword set per
  // activity (rate-limit friendly).
  const venues = await findVenuesViaNominatim(centerLat, centerLon, r, acts);
  cache.set(cacheKey, { value: venues, ts: Date.now() });
  return venues;
}

// Nominatim keywords per activity. Picked to be reasonably specific while
// keeping the number of Nominatim calls low (1 per keyword).
const NOMINATIM_KEYWORDS: Partial<Record<ActivityKind, string[]>> = {
  running: ["running track", "park", "trail"],
  cycling: ["cycle path", "park"],
  golf: ["golf course", "golf"],
  cricket: ["cricket ground", "cricket"],
  football: ["football ground", "football pitch", "park"],
  tennis: ["tennis court", "tennis"],
  hiking: ["hill station", "nature reserve", "trail", "trek"],
  picnic: ["park", "garden", "picnic spot"],
  event: ["ground", "maidan", "event venue"],
  photography: ["viewpoint", "lake", "beach", "fort"],
};

async function findVenuesViaNominatim(
  centerLat: number,
  centerLon: number,
  radiusM: number,
  acts: ActivityKind[]
): Promise<Venue[]> {
  // Compute viewbox (lon1,lat1,lon2,lat2)
  const degLat = Math.min(0.5, radiusM / 111000);
  const degLon = Math.min(0.5, radiusM / (111000 * Math.cos((centerLat * Math.PI) / 180)));
  const minLat = centerLat - degLat, maxLat = centerLat + degLat;
  const minLon = centerLon - degLon, maxLon = centerLon + degLon;
  const viewbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  // Collect unique keywords across activities
  const keywords = Array.from(new Set(acts.flatMap((a) => NOMINATIM_KEYWORDS[a] ?? [])));
  const venues: Venue[] = [];
  const seenIds = new Set<string>();
  let queryCount = 0;
  for (const kw of keywords) {
    if (queryCount > 0) {
      // Respect Nominatim's 1 req/sec limit
      await new Promise((r) => setTimeout(r, 1100));
    }
    queryCount++;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(kw)}&format=jsonv2&limit=15&viewbox=${viewbox}&bounded=1&addressdetails=0`;
      const res = await fetch(url, {
        headers: { "User-Agent": "GeoAI-Hackathon-Outdoor-Assistant/1.0 (educational)" },
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const arr = (await res.json()) as any[];
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        const id = `${r.osm_type}-${r.osm_id}`;
        if (seenIds.has(id)) continue;
        const tags: Record<string, string> = {};
        if (r.category) tags[r.category === "leisure" ? "leisure" : (r.category as string)] = r.type ?? "";
        if (r.class) tags[r.class === "leisure" ? "leisure" : (r.class as string)] = r.type ?? "";
        if (r.type) tags[r.category ?? "place"] = r.type;
        // Reuse classifyElement by faking "leisure=park" etc.
        const t = r.category === "leisure" ? { leisure: r.type } : (r.category === "natural" ? { natural: r.type } : (r.category === "tourism" ? { tourism: r.type } : (r.category === "sport" ? { sport: r.type } : (r.category === "highway" ? { highway: r.type } : { [r.category ?? "place"]: r.type ?? "" }))));
        let cats = classifyElement(t);
        if (cats.length === 0) {
          // Keep parks/gardens as generic picnic-friendly venues
          if (r.category === "leisure" && (r.type === "park" || r.type === "garden")) {
            cats = ["picnic"];
          } else {
            continue;
          }
        }
        seenIds.add(id);
        const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
        const name = (r.name && String(r.name).trim()) || fallbackName(t, r.osm_type) || "Unnamed venue";
        venues.push({
          id,
          name,
          type: r.category ?? r.type ?? "venue",
          category: cats[0],
          lat,
          lon,
          tags: t,
          distanceM: haversineM(centerLat, centerLon, lat, lon),
        });
      }
    } catch (e) {
      console.warn(`[nominatim-poi] "${kw}" failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  venues.sort((a, b) => a.distanceM - b.distanceM);
  // Deduplicate very close items
  const unique: Venue[] = [];
  for (const v of venues) {
    if (unique.some((u) => haversineM(u.lat, u.lon, v.lat, v.lon) < 50 && u.name === v.name)) continue;
    unique.push(v);
  }
  return unique.slice(0, 25);
}

function parseOverpass(
  j: any,
  centerLat: number,
  centerLon: number,
  cacheKey: string
): Venue[] {
  const els = j?.elements ?? [];
  const seen = new Set<number>();
  const venues: Venue[] = [];
  for (const el of els) {
    const id = el.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags ?? {};
    const name = tags.name ?? fallbackName(tags, el.type);
    const cats = classifyElement(tags);
    if (cats.length === 0) continue;
    venues.push({
      id: `${el.type}-${id}`,
      name,
      type: tags.leisure ?? tags.sport ?? tags.tourism ?? tags.highway ?? "venue",
      category: cats[0], // primary
      lat,
      lon,
      tags,
      distanceM: haversineM(centerLat, centerLon, lat, lon),
    });
  }
  // Sort by distance
  venues.sort((a, b) => a.distanceM - b.distanceM);
  // Deduplicate very close items (likely same venue)
  const unique: Venue[] = [];
  for (const v of venues) {
    if (unique.some((u) => haversineM(u.lat, u.lon, v.lat, v.lon) < 50 && u.name === v.name)) continue;
    unique.push(v);
  }
  // Cache
  cache.set(cacheKey, { value: unique, ts: Date.now() });
  // Cap to 25 results to keep responses manageable
  return unique.slice(0, 25);
}

function fallbackName(tags: Record<string, string>, type?: string): string {
  const parts = [
    tags.leisure,
    tags.sport,
    tags.tourism,
    tags.highway,
    tags.natural,
  ].filter(Boolean);
  if (parts.length) return parts.map((p) => p!.replace(/_/g, " ")).join(" · ");
  return type === "node" ? "Unnamed venue" : "Unnamed area";
}

/**
 * Discover geospatial context around a venue for reasoning.
 * Returns counts of features within `radiusM` (industry, green cover, water,
 * expressway/primary roads, power lines, etc.).
 */
export interface GeoContext {
  industryCount: number;
  greenCount: number;
  waterCount: number;
  arterialRoads: number;
  powerLineCount: number;
  hasSchoolOrHospital: boolean;
  industryNames: string[];
}

export async function describeGeoContext(
  lat: number, lon: number, radiusM = 1500
): Promise<GeoContext> {
  const r = Math.min(Math.max(radiusM, 800), 3000);
  const sel = [
    `nwr["landuse"~"industrial|quarry"](around:${r},${lat},${lon});`,
    `nwr["leisure"~"park|garden|nature_reserve|pitch|garden"](around:${r},${lat},${lon});`,
    `nwr["natural"~"water|wetland|wood"](around:${r},${lat},${lon});`,
    `nwr["water"~"lake|river|stream|canal"](around:${r},${lat},${lon});`,
    `nwr["highway"~"motorway|trunk|primary|secondary"](around:${r},${lat},${lon});`,
    `nwr["power"~"line|plant|substation"](around:${r},${lat},${lon});`,
    `nwr["amenity"~"school|hospital|clinic"](around:${r},${lat},${lon});`,
  ].join("");
  const q = `[out:json][timeout:20];(${sel});out tags;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: q,
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const j = await res.json();
      const els = j?.elements ?? [];
      const ctx = summariseTags(els.map((e: any) => e.tags ?? {}));
      if (ctx.industryCount || ctx.greenCount || ctx.waterCount || ctx.arterialRoads) {
        return ctx;
      }
    }
  } catch (e) {
    console.warn("[overpass-context] failed:", e instanceof Error ? e.message : String(e));
  }

  // Fallback: small Nominatim POI searches for industry and parks within a
  // 1.5 km viewbox. We keep this minimal to respect Nominatim rate limits
  // (1 req/sec). Returns at least one useful signal (industry count) which
  // is the main geospatial blocker for the activity rules.
  return describeGeoContextViaNominatim(lat, lon, r);
}

async function describeGeoContextViaNominatim(
  lat: number, lon: number, radiusM: number
): Promise<GeoContext> {
  const degLat = Math.min(0.05, radiusM / 111000);  // ~1.5 km
  const degLon = Math.min(0.05, radiusM / (111000 * Math.cos((lat * Math.PI) / 180)));
  const minLat = lat - degLat, maxLat = lat + degLat;
  const minLon = lon - degLon, maxLon = lon + degLon;
  const viewbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  const ctx: GeoContext = { ...emptyContext() };
  const keywords = [
    { kw: "industrial estate", apply: (r: any) => { ctx.industryCount++; if (r.name) ctx.industryNames.push(r.name); } },
    { kw: "park", apply: () => { ctx.greenCount++; } },
    { kw: "school", apply: () => { ctx.hasSchoolOrHospital = true; } },
  ];
  for (let i = 0; i < keywords.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100));
    const { kw, apply } = keywords[i];
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(kw)}&format=jsonv2&limit=10&viewbox=${viewbox}&bounded=1&addressdetails=0`;
      const res = await fetch(url, {
        headers: { "User-Agent": "GeoAI-Hackathon-Outdoor-Assistant/1.0 (educational)" },
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const arr = (await res.json()) as any[];
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        apply(r);
      }
    } catch (e) {
      console.warn(`[nominatim-context] "${kw}" failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  ctx.industryNames = ctx.industryNames.slice(0, 3);
  return ctx;
}

function summariseTags(tagArr: Record<string, string>[]): GeoContext {
  let industryCount = 0, greenCount = 0, waterCount = 0, arterialRoads = 0, powerLineCount = 0;
  const industryNames: string[] = [];
  let hasSchoolOrHospital = false;
  for (const t of tagArr) {
    if (t.landuse === "industrial" || t.landuse === "quarry") {
      industryCount++;
      if (t.name) industryNames.push(t.name);
    }
    if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "nature_reserve") greenCount++;
    if (t.natural === "water" || t.natural === "wetland" || t.natural === "wood" || t.water) waterCount++;
    if (t.highway === "motorway" || t.highway === "trunk" || t.highway === "primary" || t.highway === "secondary") arterialRoads++;
    if (t.power === "line" || t.power === "plant" || t.power === "substation") powerLineCount++;
    if (t.amenity === "school" || t.amenity === "hospital" || t.amenity === "clinic") hasSchoolOrHospital = true;
  }
  return { industryCount, greenCount, waterCount, arterialRoads, powerLineCount, hasSchoolOrHospital, industryNames: industryNames.slice(0, 3) };
}

function emptyContext(): GeoContext {
  return { industryCount: 0, greenCount: 0, waterCount: 0, arterialRoads: 0, powerLineCount: 0, hasSchoolOrHospital: false, industryNames: [] };
}
