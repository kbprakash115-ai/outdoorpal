/**
 * Nominatim geocoding — place name → coordinates.
 * Source: https://nominatim.openstreetmap.org/
 * Usage policy: max 1 req/sec, must identify with a User-Agent.
 * © OpenStreetMap contributors
 */

export interface GeoLocation {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number]; // south, north, west, east
  type?: string;
  importance?: number;
}

// Simple in-memory cache (24h TTL)
const cache = new Map<string, { value: GeoLocation | null; ts: number }>();
const TTL = 24 * 60 * 60 * 1000;

export async function geocode(query: string): Promise<GeoLocation | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.value;

  // Hackathon context is Indian cities. Try India-biased geocoding first
  // (countrycodes=in), then fall back to a global search if no match.
  const results = await Promise.all([
    nominatimSearch(query, "in"),
    new Promise<(GeoLocation | null)>(r => setTimeout(() => r(null), 50)),
  ]);

  let loc = results[0];
  if (!loc) {
    // Global search fallback
    loc = await nominatimSearch(query, undefined);
  }

  cache.set(key, { value: loc, ts: Date.now() });
  return loc;
}

async function nominatimSearch(query: string, country?: string): Promise<GeoLocation | null> {
  try {
    const cc = country ? `&countrycodes=${country}` : "";
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      query
    )}${cc}&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "GeoAI-Hackathon-Outdoor-Assistant/1.0 (educational)",
      },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      console.warn("[nominatim] non-OK", res.status);
      return null;
    }
    const arr = (await res.json()) as Array<any>;
    if (!arr || arr.length === 0) return null;
    const r = arr[0];
    const loc: GeoLocation = {
      name: r.name ?? query,
      displayName: r.display_name ?? query,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      bbox: r.boundingbox
        ? [
            parseFloat(r.boundingbox[0]),
            parseFloat(r.boundingbox[1]),
            parseFloat(r.boundingbox[2]),
            parseFloat(r.boundingbox[3]),
          ]
        : [
            parseFloat(r.lat) - 0.05,
            parseFloat(r.lat) + 0.05,
            parseFloat(r.lon) - 0.05,
            parseFloat(r.lon) + 0.05,
          ],
      type: r.type,
      importance: r.importance,
    };
    return loc;
  } catch (e) {
    console.error("[nominatim] error", e);
    return null;
  }
}
