"use client";

import { useMemo, useRef, useState } from "react";
import GhostMap from "./GhostMap";
import type { GhostRoute, GhostStop, LatLngTuple } from "./GhostMap";

const CLEAN_COLOR = "#00f3ff";
const RAW_COLOR = "#ffb86b";
const MAX_INPUT_LENGTH = 4000;

/** Shape returned by `POST /api/normalize-route`. */
interface NormalizedResponse {
  routeName: string;
  vehicleType: string;
  estimatedFare: string;
  frequency: string;
  stops: { name: string; lat: number; lng: number }[];
  /** `[latitude, longitude]` pairs. */
  pathCoordinates: [number, number][];
}

/** Shown until the first normalization so the map is never a dead canvas. */
const DEMO_ROUTES: GhostRoute[] = [
  {
    id: "mg-road-indiranagar",
    name: "MG Road → Indiranagar",
    coordinates: [
      [12.9756, 77.6068],
      [12.9784, 77.622],
      [12.9784, 77.6408],
    ],
  },
  {
    id: "mg-road-koramangala",
    name: "MG Road → Koramangala",
    color: "#7cf6a0",
    coordinates: [
      [12.9756, 77.6068],
      [12.96, 77.61],
      [12.95, 77.62],
      [12.9352, 77.6245],
    ],
  },
];

const DEMO_STOPS: GhostStop[] = [
  { id: "mg-road", name: "MG Road Metro", latitude: 12.9756, longitude: 77.6068 },
  { id: "indiranagar", name: "Indiranagar", latitude: 12.9784, longitude: 77.6408 },
  { id: "koramangala", name: "Koramangala", latitude: 12.9352, longitude: 77.6245, color: "#7cf6a0" },
];

function pairFromNumbers(first: number, second: number): LatLngTuple | null {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  // Accept [lat, lng] first, then the GeoJSON-friendly [lng, lat].
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return [first, second];
  if (Math.abs(first) <= 180 && Math.abs(second) <= 90) return [second, first];
  return null;
}

/** Walks parsed JSON of any nesting and pulls out coordinate-looking pairs. */
function collectPairs(value: unknown, out: LatLngTuple[], depth = 0) {
  if (depth > 6 || out.length >= 500) return;

  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const pair = pairFromNumbers(value[0], value[1]);
      if (pair) {
        out.push(pair);
        return;
      }
    }
    value.forEach((entry) => collectPairs(entry, out, depth + 1));
    return;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const lat = Number(record.lat ?? record.latitude);
    const lng = Number(record.lng ?? record.lon ?? record.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const pair = pairFromNumbers(lat, lng);
      if (pair) {
        out.push(pair);
        return;
      }
    }
    Object.values(record).forEach((entry) => collectPairs(entry, out, depth + 1));
  }
}

/**
 * Best-effort extraction of the "jittery" points the user supplied.
 * Handles JSON / GeoJSON and loose text such as `12.9756, 77.6068` per line.
 */
function extractRawPoints(rawInput: string): LatLngTuple[] {
  const text = rawInput.trim();
  if (!text) return [];

  const fromJson: LatLngTuple[] = [];
  if (/^[[{]/.test(text)) {
    try {
      collectPairs(JSON.parse(text), fromJson);
    } catch {
      // Not valid JSON — fall through to the text scan.
    }
    if (fromJson.length >= 2) return fromJson.slice(0, 500);
  }

  // Only comma/semicolon separated pairs, so prose like "INR 25-30" is ignored.
  const points: LatLngTuple[] = [];
  const pairPattern = /(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/g;
  for (const match of text.matchAll(pairPattern)) {
    const pair = pairFromNumbers(Number(match[1]), Number(match[2]));
    if (pair) points.push(pair);
    if (points.length >= 500) break;
  }
  return points;
}

function SplitToggle({
  value,
  onChange,
  disabled,
}: {
  value: "clean" | "raw";
  onChange: (next: "clean" | "raw") => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id="raw-vs-clean-label" className="text-[11px] tracking-[0.2em] text-slate-400 uppercase">
        Show Raw vs. AI Cleaned
      </span>
      <div
        role="group"
        aria-labelledby="raw-vs-clean-label"
        className={`flex rounded-full border border-cyan-500/25 bg-[#050b14] p-0.5 ${
          disabled ? "opacity-50" : ""
        }`}
      >
        <button
          type="button"
          aria-pressed={value === "raw"}
          disabled={disabled}
          onClick={() => onChange("raw")}
          className={`rounded-full px-3 py-1 text-[11px] font-medium tracking-wide transition disabled:cursor-not-allowed ${
            value === "raw" ? "bg-[#ffb86b]/20 text-[#ffcf94]" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Raw
        </button>
        <button
          type="button"
          aria-pressed={value === "clean"}
          disabled={disabled}
          onClick={() => onChange("clean")}
          className={`rounded-full px-3 py-1 text-[11px] font-medium tracking-wide transition disabled:cursor-not-allowed ${
            value === "clean" ? "bg-cyan-400/20 text-cyan-200" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          AI Cleaned
        </button>
      </div>
    </div>
  );
}

export default function GhostRouteStudio() {
  const [rawInput, setRawInput] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NormalizedResponse | null>(null);
  const [view, setView] = useState<"clean" | "raw">("clean");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const rawPoints = useMemo(() => extractRawPoints(rawInput), [rawInput]);

  const cleanRoutes = useMemo<GhostRoute[]>(() => {
    if (!result) return DEMO_ROUTES;
    const coordinates =
      result.pathCoordinates.length >= 2
        ? result.pathCoordinates
        : result.stops.map((stop) => [stop.lat, stop.lng] as LatLngTuple);
    return [{ id: "ai-route", name: result.routeName, color: CLEAN_COLOR, coordinates }];
  }, [result]);

  const cleanStops = useMemo<GhostStop[]>(() => {
    if (!result) return DEMO_STOPS;
    return result.stops.map((stop, index) => ({
      id: `ai-stop-${index}`,
      name: stop.name,
      latitude: stop.lat,
      longitude: stop.lng,
      color: CLEAN_COLOR,
    }));
  }, [result]);

  /**
   * The raw layer is the user's own points. If the input was prose only there is
   * nothing jittery to draw, so fall back to the unsmoothed stop order.
   */
  const rawFromStops = rawPoints.length < 2;
  const rawRoutes = useMemo<GhostRoute[]>(() => {
    if (!result) return [];
    const coordinates: LatLngTuple[] = rawFromStops
      ? result.stops.map((stop) => [stop.lat, stop.lng] as LatLngTuple)
      : rawPoints;
    if (coordinates.length < 2) return [];
    return [
      {
        id: "raw-route",
        name: rawFromStops ? "Unnormalized stop order" : "Raw input coordinates",
        color: RAW_COLOR,
        coordinates,
      },
    ];
  }, [result, rawPoints, rawFromStops]);

  const rawStops = useMemo<GhostStop[]>(() => {
    if (!result || rawFromStops) return [];
    return rawPoints.map(([lat, lng], index) => ({
      id: `raw-point-${index}`,
      name: `Point ${index + 1}`,
      latitude: lat,
      longitude: lng,
      color: RAW_COLOR,
    }));
  }, [result, rawPoints, rawFromStops]);

  const showingRaw = view === "raw" && result !== null;
  const activeRoutes = showingRaw ? rawRoutes : cleanRoutes;
  const activeStops = showingRaw ? rawStops : cleanStops;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    const trimmed = rawInput.trim();
    if (!trimmed) {
      setError("Type an informal route description or paste some coordinates first.");
      textareaRef.current?.focus();
      return;
    }
    if (trimmed.length > MAX_INPUT_LENGTH) {
      setError(`Keep the input under ${MAX_INPUT_LENGTH} characters (currently ${trimmed.length}).`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/normalize-route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawInput: trimmed }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const failure = payload as { error?: string; detail?: string } | null;
        const message = [failure?.error, failure?.detail].filter(Boolean).join(" — ");
        throw new Error(message || `Normalization failed (HTTP ${response.status}).`);
      }

      setResult(payload as NormalizedResponse);
      setView("clean");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Something went wrong while normalizing the route.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    if (file.size > 200_000) {
      setError("That file is too large — keep coordinate uploads under 200 KB.");
      return;
    }

    try {
      const text = await file.text();
      setRawInput(text.slice(0, MAX_INPUT_LENGTH));
      setFileName(file.name);
      setError(null);
    } catch {
      setError("Could not read that file. Try a plain .txt, .csv, .json or .geojson file.");
    }
  }

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-[#050b14]/80 p-4"
      >
        <div>
          <label
            htmlFor="raw-route-input"
            className="text-[11px] tracking-[0.2em] text-cyan-300/80 uppercase"
          >
            Route input
          </label>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Describe the ride the way you&apos;d tell a friend, or paste messy GPS coordinates.
          </p>
        </div>

        <textarea
          id="raw-route-input"
          ref={textareaRef}
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
          spellCheck={false}
          rows={7}
          disabled={isLoading}
          placeholder={"take the shared auto from Majestic, get down near Sony World Signal, then walk to Forum Koramangala. 25 rupees, every 10 mins.\n\nor\n\n12.9756,77.6068\n12.9784,77.622\n12.9784,77.6408"}
          className="w-full resize-y rounded-xl border border-cyan-500/20 bg-[#03070f] p-3 font-mono text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 focus:outline-none disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json,.geojson,text/plain,application/json"
            className="sr-only"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={isLoading}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-cyan-500/25 px-3 py-1.5 text-[11px] tracking-wide text-cyan-200/90 transition hover:border-cyan-400/50 hover:bg-cyan-400/10 disabled:opacity-50"
          >
            Upload coordinates
          </button>
          <span className="truncate text-[11px] text-slate-500">
            {fileName ?? ".txt · .csv · .json · .geojson"}
          </span>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading}
          className="relative flex items-center justify-center gap-2 overflow-hidden rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25 disabled:cursor-wait disabled:opacity-80"
        >
          {isLoading ? (
            <>
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-200/30 border-t-cyan-200"
              />
              <span className="animate-pulse">Normalizing with Gemini…</span>
            </>
          ) : (
            "Normalize Route with Gemini AI"
          )}
        </button>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200"
          >
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="mt-1 space-y-2 rounded-xl border border-cyan-500/15 bg-[#03070f]/80 p-3">
            <p className="text-sm font-medium text-cyan-50">{result.routeName}</p>
            <dl className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
              <div>
                <dt className="tracking-[0.15em] text-slate-500 uppercase">Vehicle</dt>
                <dd className="text-slate-200">{result.vehicleType}</dd>
              </div>
              <div>
                <dt className="tracking-[0.15em] text-slate-500 uppercase">Fare</dt>
                <dd className="text-slate-200">{result.estimatedFare}</dd>
              </div>
              <div>
                <dt className="tracking-[0.15em] text-slate-500 uppercase">Frequency</dt>
                <dd className="text-slate-200">{result.frequency}</dd>
              </div>
              <div>
                <dt className="tracking-[0.15em] text-slate-500 uppercase">Points</dt>
                <dd className="text-slate-200">
                  {rawPoints.length || "—"} raw → {result.stops.length} stops
                </dd>
              </div>
            </dl>
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {result.stops.map((stop, index) => (
                <li key={`${stop.name}-${index}`} className="flex items-start gap-2 text-[11px] text-slate-300">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_6px_#00f3ff]" />
                  <span>
                    {stop.name}
                    <span className="block text-[10px] text-slate-500">
                      {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-500">
            Nothing normalized yet — the map below is showing demo routes.
          </p>
        )}
      </form>

      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SplitToggle value={view} onChange={setView} disabled={!result || isLoading} />
          <div className="flex items-center gap-3 text-[10px] tracking-[0.15em] uppercase">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00f3ff] shadow-[0_0_6px_#00f3ff]" />
              AI cleaned
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ffb86b] shadow-[0_0_6px_#ffb86b]" />
              Raw input
            </span>
          </div>
        </div>

        <div className="relative h-[58vh] min-h-[340px] overflow-hidden rounded-2xl border border-cyan-500/25 shadow-[0_0_40px_-12px_rgba(0,243,255,0.55)] lg:h-[calc(100dvh-14rem)]">
          <GhostMap routes={activeRoutes} stops={activeStops} fitToContent />

          {showingRaw && rawFromStops ? (
            <p className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-full border border-[#ffb86b]/40 bg-[#050b14]/90 px-3 py-1 text-[10px] text-[#ffcf94]">
              No coordinates in the input — showing unsmoothed stop order
            </p>
          ) : null}

          {isLoading ? (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-[#03070f]/45 backdrop-blur-[1px]">
              <span className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-[#050b14]/90 px-4 py-2 text-[11px] tracking-[0.2em] text-cyan-200 uppercase animate-pulse">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-200/30 border-t-cyan-200"
                />
                Normalizing route
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
