/**
 * OSRM routing — travel time / road distance from origin → venue.
 * Public OSRM demo server: https://router.project-osrm.org/
 * (Production use should self-host OSRM.)
 */

export interface TravelInfo {
  distanceM: number;
  durationS: number;
  durationMin: number;
  reachable: boolean;
}

const cache = new Map<string, { value: TravelInfo; ts: number }>();
const TTL = 30 * 60 * 1000;

export async function route(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number
): Promise<TravelInfo> {
  const key = `${fromLat.toFixed(4)},${fromLon.toFixed(4)}|${toLat.toFixed(4)},${toLon.toFixed(4)}`;
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.value;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false&steps=false`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return fail();
    const j = await res.json();
    const r = j?.routes?.[0];
    if (!r) return fail();
    const info: TravelInfo = {
      distanceM: r.distance ?? 0,
      durationS: r.duration ?? 0,
      durationMin: Math.round((r.duration ?? 0) / 60),
      reachable: true,
    };
    cache.set(key, { value: info, ts: Date.now() });
    return info;
  } catch (e) {
    console.error("[osrm] error", e);
    return fail();
  }
}

function fail(): TravelInfo {
  return { distanceM: 0, durationS: 0, durationMin: 0, reachable: false };
}
