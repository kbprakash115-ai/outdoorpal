# Data sources disclosure

Per the GeoAI Hackathon rulebook, every free / open data source used by the assistant is disclosed here, with the URL, what we use it for, and how we respect its rate limits.

## Live data sources

| # | Source | URL | Used for | Rate-limit / attribution |
|---|---|---|---|---|
| 1 | OpenStreetMap — Overpass API | https://overpass-api.de/ | Venue search (parks, pitches, golf courses, hiking trails, viewpoints, etc.) + geospatial context (industry, green, water, arterial roads, power lines, schools/hospitals) | 1 request / 15 s; 25 s server timeout; we send a `User-Agent` per Overpass usage policy |
| 2 | OpenStreetMap — Nominatim | https://nominatim.openstreetmap.org/ | Place-name → coordinates (geocoding); POI fallback search when Overpass is unreachable | 1 request / second; identified with `User-Agent: GeoAI-Hackathon-Outdoor-Assistant/1.0` |
| 3 | Open-Meteo — Forecast API | https://open-meteo.com/en/docs | Hourly temperature, apparent temperature, precipitation probability & amount, wind speed + direction + gusts, cloud cover, UV index, relative humidity, visibility, weather code, daylight flag; daily sunrise/sunset, temperature max/min, precip sum, UV max | Free, no API key, ≤10 000 calls/day; we cache results 30 min |
| 4 | Open-Meteo — Air Quality API | https://open-meteo.com/en/docs/air-quality-api | PM10, PM2.5, European AQI, US AQI hourly | Same as above |
| 5 | OSRM — public routing server | https://router.project-osrm.org/ | Driving time + distance from origin to each candidate venue | Demo server; we cache 30 min and cap concurrent requests. For production, self-host OSRM with a regional OSM extract. |
| 6 | Hugging Face Hub | https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct | Hosts the SLM weights (Qwen2.5-1.5B-Instruct, open-weights, ≤3 B parameters). Inference is via the HF Inference API. | Read token; free tier |
| 7 | OpenStreetMap — main read API (fallback) | https://api.openstreetmap.org/api/0.6/ | Used only as a defensive fallback when all Overpass servers are unreachable. We fetch a small bbox and parse the raw XML for venue + context information. | Hard cap 50 000 nodes/request, 0.25°×0.25° bbox; we send a `User-Agent`. Used sparingly. |

## Attribution

**Map data © OpenStreetMap contributors**, ODbL 1.0 — https://www.openstreetmap.org/copyright.

Open-Meteo data is © Open-Meteo, CC BY 4.0 — https://open-meteo.com/en/docs.

## Models / libraries used

- **SLM**: `Qwen/Qwen2.5-1.5B-Instruct` (open Qwen license, 1.54 B parameters, ≤3 B cap ✓)
- **Coding aid**: Z.ai (used as a coding aid during development, **disclosed** per hackathon rule). ChatGPT-class models were NOT used inside the running assistant.
- **Frameworks**: Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Leaflet, Zustand, TanStack Query
- **No** private or paid data sources were used.
- **No** data was scraped behind logins.
- **No** answers are hard-coded for the example queries.

## Rate-limit handling

- **In-memory cache** (30-minute TTL) on weather, AQ and venue lookups so that repeat questions within a session return instantly without re-hitting the upstream.
- **Sequential Nominatim** calls with a 1.1-second pause between each (per Nominatim usage policy of 1 req/sec).
- **Parallel fetch per venue** — weather, geospatial context and travel time run in `Promise.all` so we make the minimum number of round-trips.
- **Hard cap of 4 candidate venues** to keep total upstream calls bounded (typical request: 1 geocode + ~3 venue search + 4×(forecast+context+route) ≈ 20 upstream calls, completed in 15-30 seconds).
