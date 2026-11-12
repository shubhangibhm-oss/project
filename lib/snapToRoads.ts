/**
 * Street-level road snapping for AI-normalized routes.
 *
 * Gemini gives us stops and a rough polyline; the public OSRM demo server can
 * turn those stops into real road geometry (including turns) with no API key.
 * Every function here is failure-tolerant: if OSRM is slow, rate-limited or
 * unhappy, the caller simply keeps Gemini's own `pathCoordinates`.
 */

export interface SnapStop {
  name?: string;
  lat: number;
  lng: number;
}

/** `[latitude, longitude]` — the order Leaflet and GhostMap expect. */
export type LatLng = [number, number];

const OSRM_ROUTE_BASE = "https://router.project-osrm.org/route/v1/driving";

/** Hard cap so a hanging OSRM request can never stall normalization. */
export const OSRM_TIMEOUT_MS = 3000;

function isUsableStop(stop: SnapStop): boolean {
  return (
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng) &&
    Math.abs(stop.lat) <= 90 &&
    Math.abs(stop.lng) <= 180
  );
}

/**
 * Builds the OSRM request URL. OSRM takes `lng,lat` pairs separated by `;`,
 * with up to 100 waypoints on the public demo server.
 */
export function buildOsrmUrl(stops: SnapStop[]): string | null {
  const waypoints = stops
    .filter(isUsableStop)
    .slice(0, 100)
    .map((stop) => `${stop.lng},${stop.lat}`);

  if (waypoints.length < 2) return null;

  return `${OSRM_ROUTE_BASE}/${waypoints.join(";")}?overview=full&geometries=geojson`;
}

/** GeoJSON coordinates are `[lng, lat]`; convert them to `[lat, lng]`. */
function toLatLng(value: unknown): LatLng | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

/** Pulls the full road geometry out of an OSRM `route` response. */
export function extractPath(payload: unknown): LatLng[] {
  if (typeof payload !== "object" || payload === null) return [];

  const routes = (payload as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return [];

  const geometry = (routes[0] as { geometry?: { coordinates?: unknown } } | null)?.geometry;
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];

  return coordinates
    .map(toLatLng)
    .filter((point): point is LatLng => point !== null);
}

/**
 * Snaps the given stops to real roads and returns the route geometry as
 * `[lat, lng]` pairs. Resolves to `null` on any problem — no stops, network
 * error, non-200 response, bad JSON, empty geometry, or a >3s timeout — so the
 * caller can fall back to the model's coordinates without a visible failure.
 */
export async function snapStopsToRoads(
  stops: SnapStop[],
  timeoutMs: number = OSRM_TIMEOUT_MS,
): Promise<LatLng[] | null> {
  const url = buildOsrmUrl(stops);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const path = extractPath(await response.json());
    return path.length >= 2 ? path : null;
  } catch {
    // Abort (timeout), DNS, TLS, rate limiting — all indistinguishable to the
    // caller, which keeps Gemini's path in every case.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
