import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { snapStopsToRoads } from "@/lib/snapToRoads";

/** The Gen AI SDK needs Node APIs; keep this off the edge runtime. */
export const runtime = "nodejs";

// Primary model, with an automatic retry on a second model before falling back.
const PRIMARY_MODEL = "gemini-3.5-flash-lite";
const RETRY_MODEL = "gemini-3.8-flash";
/** Per-attempt cap so a slow/hovering model can never hang a live demo. */
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RAW_INPUT_LENGTH = 4000;

const VEHICLE_TYPES = ["Shared Auto", "Minibus", "Informal Van"] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number];

interface NormalizedStop {
  name: string;
  lat: number;
  lng: number;
}

interface NormalizedRoute {
  routeName: string;
  vehicleType: VehicleType | string;
  estimatedFare: string;
  frequency: string;
  stops: NormalizedStop[];
  pathCoordinates: [number, number][];
  /** True when this is the pre-built demo route, not a live model response. */
  isFallback?: boolean;
}

const SYSTEM_PROMPT = `You are a GIS & Transit Data Normalizer for "Ghost Routes", an app that maps Bengaluru's informal transit (shared autos, minibuses, informal vans).

You receive messy human input: informal directions ("take the shared auto from Majestic, get down near Sony World Signal, then walk to Forum"), shorthand, fare notes, frequency gossip, or noisy GPS coordinate lists.

Turn it into ONE clean, machine-readable route object:

- routeName: short human route name, e.g. "Majestic to Koramangala via Sony World Signal". Never invent a different origin or destination than the input implies.
- vehicleType: exactly one of "Shared Auto", "Minibus", "Informal Van". Infer it from the input. If the input mentions another mode, pick the closest of these three rather than inventing a new category.
- estimatedFare: fare with currency when stated, e.g. "INR 25-30". If the input gives no fare, use "Unknown".
- frequency: how often the service runs, e.g. "Every 10-15 mins". If not stated, use "Unknown".
- stops: ordered stops from origin to destination, each with a name, lat and lng in decimal degrees. Use your knowledge of Bengaluru geography to place well-known landmarks and neighbourhoods. If a stop cannot be located confidently, leave it out instead of inventing coordinates.
- pathCoordinates: ordered [lat, lng] pairs tracing the route through the stops, suitable for a Leaflet polyline. Include at least every stop coordinate plus intermediate points so the line follows roads instead of cutting across buildings.

Rules:
- Coordinates are decimal degrees: lat between -90 and 90, lng between -180 and 180, always in [lat, lng] order.
- If the input already contains coordinates, preserve their order and silently fix obvious lat/lng swaps.
- If the input is ambiguous, choose the most plausible interpretation and keep going; do not ask questions.
- Return only JSON that matches the provided schema. No prose, no markdown, no code fences.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    routeName: {
      type: Type.STRING,
      description: "Short human readable route name, e.g. 'Majestic to Koramangala via Sony World Signal'.",
    },
    vehicleType: {
      type: Type.STRING,
      enum: [...VEHICLE_TYPES],
      description: "The informal transit vehicle type.",
    },
    estimatedFare: {
      type: Type.STRING,
      description: "Fare with currency, e.g. 'INR 25-30', or 'Unknown'.",
    },
    frequency: {
      type: Type.STRING,
      description: "Service frequency, e.g. 'Every 10-15 mins', or 'Unknown'.",
    },
    stops: {
      type: Type.ARRAY,
      description: "Ordered stops from origin to destination.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Stop or landmark name." },
          lat: { type: Type.NUMBER, description: "Latitude in decimal degrees." },
          lng: { type: Type.NUMBER, description: "Longitude in decimal degrees." },
        },
        required: ["name", "lat", "lng"],
        propertyOrdering: ["name", "lat", "lng"],
      },
    },
    pathCoordinates: {
      type: Type.ARRAY,
      description: "Ordered [lat, lng] pairs tracing the route for a Leaflet polyline.",
      items: {
        type: Type.ARRAY,
        items: { type: Type.NUMBER },
      },
    },
  },
  required: ["routeName", "vehicleType", "estimatedFare", "frequency", "stops", "pathCoordinates"],
  propertyOrdering: ["routeName", "vehicleType", "estimatedFare", "frequency", "stops", "pathCoordinates"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Accepts `[lat, lng]` / `{ lat, lng }` shapes and rejects anything non-numeric. */
function toCoordinatePair(value: unknown): [number, number] | null {
  let lat: number;
  let lng: number;

  if (Array.isArray(value) && value.length >= 2) {
    lat = Number(value[0]);
    lng = Number(value[1]);
  } else if (isRecord(value)) {
    lat = Number(value.lat ?? value.latitude);
    lng = Number(value.lng ?? value.lon ?? value.longitude);
  } else {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

function toText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function toVehicleType(value: unknown): VehicleType {
  if (typeof value === "string") {
    const match = VEHICLE_TYPES.find((type) => type.toLowerCase() === value.trim().toLowerCase());
    if (match) return match;
    if (/van/i.test(value)) return "Informal Van";
    if (/mini|bus/i.test(value)) return "Minibus";
    if (/auto/i.test(value)) return "Shared Auto";
  }
  return "Shared Auto";
}

/** Defensive normalisation: the model output is data, never trusted blindly. */
function normalizeRoute(raw: unknown): NormalizedRoute | null {
  if (!isRecord(raw)) return null;

  const stops: NormalizedStop[] = [];
  if (Array.isArray(raw.stops)) {
    for (const entry of raw.stops) {
      if (!isRecord(entry)) continue;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const pair = toCoordinatePair(entry);
      if (!name || !pair) continue;
      stops.push({ name, lat: pair[0], lng: pair[1] });
    }
  }

  const pathCoordinates: [number, number][] = [];
  if (Array.isArray(raw.pathCoordinates)) {
    for (const entry of raw.pathCoordinates) {
      const pair = toCoordinatePair(entry);
      if (pair) pathCoordinates.push(pair);
    }
  }

  // Fall back to the stop positions so the map always has a drawable line.
  if (pathCoordinates.length < 2) {
    pathCoordinates.length = 0;
    for (const stop of stops) pathCoordinates.push([stop.lat, stop.lng]);
  }

  if (stops.length === 0 && pathCoordinates.length < 2) return null;

  return {
    routeName: toText(raw.routeName, "Unnamed informal route"),
    vehicleType: toVehicleType(raw.vehicleType),
    estimatedFare: toText(raw.estimatedFare, "Unknown"),
    frequency: toText(raw.frequency, "Unknown"),
    stops,
    pathCoordinates,
  };
}

/**
 * Pre-built Bengaluru route used whenever the model cannot answer (high demand,
 * quota, timeout, bad key). It matches the schema exactly, so the map always
 * has a drawable route for a live demo.
 */
const FALLBACK_ROUTE: NormalizedRoute = {
  routeName: "Majestic to Forum Koramangala via Sony World Signal",
  vehicleType: "Shared Auto",
  estimatedFare: "INR 25",
  frequency: "Every 10-15 mins",
  stops: [
    { name: "Majestic (Kempegowda Bus Station)", lat: 12.9767, lng: 77.5713 },
    { name: "KR Market", lat: 12.9618, lng: 77.5755 },
    { name: "Lalbagh West Gate", lat: 12.9507, lng: 77.5848 },
    { name: "Sony World Signal, Koramangala", lat: 12.936, lng: 77.6271 },
    { name: "Forum Mall, Koramangala", lat: 12.9345, lng: 77.6113 },
  ],
  pathCoordinates: [
    [12.9767, 77.5713],
    [12.9722, 77.5772],
    [12.9698, 77.5878],
    [12.9651, 77.5991],
    [12.9588, 77.6105],
    [12.9517, 77.6198],
    [12.9451, 77.6245],
    [12.9402, 77.6268],
    [12.936, 77.6271],
    [12.9345, 77.6113],
  ],
};

async function fallbackResponse() {
  const snapped = await withRoadSnapping(FALLBACK_ROUTE);
  return NextResponse.json({ ...snapped, isFallback: true }, { status: 200 });
}

function errorResponse(status: number, error: string, detail?: string) {
  return NextResponse.json(detail ? { error, detail } : { error }, { status });
}

/** One model attempt. Throws on any failure so the caller can retry or fall back. */
async function generateRoute(
  ai: GoogleGenAI,
  model: string,
  rawInput: string,
): Promise<NormalizedRoute> {
  const response = await ai.models.generateContent({
    model,
    contents: rawInput.trim(),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      // Deterministic-ish extraction: minimal sampling, single candidate.
      topP: 0.9,
      candidateCount: 1,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
    },
  });

  const text = response.text;
  if (!text) throw new Error(`${model} returned an empty response`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${model} returned malformed JSON`);
  }

  const normalized = normalizeRoute(parsed);
  if (!normalized) throw new Error(`${model} returned no usable stops or coordinates`);

  return normalized;
}

/**
 * Replaces the model's straight-ish polyline with real street geometry between
 * the extracted stops. OSRM is best-effort: if it fails or exceeds its 3s cap,
 * Gemini's original `pathCoordinates` are kept untouched.
 */
async function withRoadSnapping(route: NormalizedRoute): Promise<NormalizedRoute> {
  const snapped = await snapStopsToRoads(route.stops);
  if (!snapped || snapped.length < 2) return route;
  return { ...route, pathCoordinates: snapped };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn("[normalize-route] GEMINI_API_KEY is not set — serving the demo fallback route");
    return fallbackResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be valid JSON", 'Expected { "rawInput": string }.');
  }

  const rawInput = isRecord(body) ? body.rawInput : undefined;
  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    return errorResponse(400, "rawInput is required", "Provide a non-empty string describing the route.");
  }
  if (rawInput.length > MAX_RAW_INPUT_LENGTH) {
    return errorResponse(400, "rawInput is too long", `Limit is ${MAX_RAW_INPUT_LENGTH} characters.`);
  }

  const ai = new GoogleGenAI({ apiKey });

  // Primary model, then one automatic retry on the fallback model. Any error
  // (503 high demand, 429 quota, timeout, bad key, unparseable output) is caught
  // and simply moves on to the next attempt, and finally to the demo route.
  for (const model of [PRIMARY_MODEL, RETRY_MODEL]) {
    try {
      const normalized = await withRoadSnapping(await generateRoute(ai, model, rawInput));
      return NextResponse.json({ ...normalized, isFallback: false }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn(`[normalize-route] ${model} attempt failed: ${message}`);
    }
  }

  console.warn("[normalize-route] all model attempts failed — serving the demo fallback route");
  return await fallbackResponse();
}
