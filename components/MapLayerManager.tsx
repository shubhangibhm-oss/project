"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GhostRoute } from "./ghost-map.types";

const DEFAULT_CENTER: [number, number] = [13.028, 77.545]; // Bengaluru
const DEFAULT_ZOOM = 13;
const ROUTE_COLOR = "#00f3ff";
const RAW_COLOR = "#ffb86b";
const SAVED_COLOR = "#7cf6a0";

export interface ManagedStop {
  name: string;
  lat: number;
  lng: number;
}

/** The AI-normalized route shape this manager renders. */
export interface ManagedRoute {
  routeName?: string;
  vehicleType?: string;
  estimatedFare?: string;
  frequency?: string;
  /** Ordered `[latitude, longitude]` pairs. */
  pathCoordinates?: [number, number][];
  stops?: ManagedStop[];
}

export interface MapLayerManagerProps {
  /** AI route to draw; omit or pass null for an empty base map. */
  route?: ManagedRoute | null;
  /** Messy input coordinates, drawn as amber pins by the "Raw pins" layer. */
  rawCoordinates?: [number, number][];
  /** Routes persisted elsewhere (e.g. Supabase), drawn as a dashed layer. */
  savedRoutes?: GhostRoute[];
  center?: [number, number];
  zoom?: number;
  className?: string;
}

type LayerKey = "route" | "stops" | "raw" | "saved";
type InteractiveLayer = L.Polyline | L.CircleMarker | L.Marker;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

/** Applies a CSS filter to a rendered SVG path (Leaflet paths are SVG elements). */
function applyFilter(layer: L.Path, value: string) {
  const element = layer.getElement();
  if (element instanceof SVGElement) {
    element.style.setProperty("filter", value);
  }
}

/** Popup card: vehicle type, fare, and the sequential stop names. */
function buildRouteCard(route: ManagedRoute | null | undefined, activeStopIndex?: number): string {
  if (!route) return "";

  const title = route.routeName?.trim() || "AI normalized route";
  const vehicle = route.vehicleType?.trim() || "Unknown vehicle";
  const fare = route.estimatedFare?.trim() || "Unknown fare";
  const frequency = route.frequency?.trim();
  const stops = route.stops ?? [];

  const stopItems = stops
    .map(
      (stop, index) =>
        `<li${index === activeStopIndex ? ' class="mlm-stop is-active"' : ' class="mlm-stop"'}>` +
        `<span class="mlm-stop__index">${index + 1}</span>` +
        `<span class="mlm-stop__name">${escapeHtml(stop.name)}</span>` +
        `</li>`,
    )
    .join("");

  return (
    `<div class="mlm-card">` +
    `<p class="mlm-card__eyebrow">Ghost route</p>` +
    `<p class="mlm-card__title">${escapeHtml(title)}</p>` +
    `<div class="mlm-card__meta">` +
    `<span><b>Vehicle</b>${escapeHtml(vehicle)}</span>` +
    `<span><b>Fare</b>${escapeHtml(fare)}</span>` +
    (frequency ? `<span><b>Runs</b>${escapeHtml(frequency)}</span>` : "") +
    `</div>` +
    (stops.length
      ? `<ol class="mlm-card__stops">${stopItems}</ol>`
      : `<p class="mlm-card__empty">No stops in this route.</p>`) +
    `</div>`
  );
}

function buildRawCard(lat: number, lng: number, index: number): string {
  return (
    `<div class="mlm-card">` +
    `<p class="mlm-card__eyebrow">Raw input pin ${index + 1}</p>` +
    `<p class="mlm-card__title">${lat.toFixed(5)}, ${lng.toFixed(5)}</p>` +
    `<p class="mlm-card__empty">Untouched coordinate, before AI normalization.</p>` +
    `</div>`
  );
}

function createStopIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "mlm-pin",
    html: `
      <div style="filter: drop-shadow(0 0 6px ${color});">
        <svg width="26" height="34" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M15 38.5C15 38.5 28 23.2 28 14.2C28 7 22.2 1 15 1C7.8 1 2 7 2 14.2C2 23.2 15 38.5 15 38.5Z"
            fill="#050b14" stroke="${color}" stroke-width="2" />
          <circle cx="15" cy="14.2" r="4.6" fill="${color}" />
          <circle cx="15" cy="14.2" r="1.6" fill="#050b14" />
        </svg>
      </div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -28],
    tooltipAnchor: [0, -30],
  });
}

/**
 * MapLayerManager — client-only Leaflet surface with hover/click popup cards,
 * automatic `fitBounds()` on every new AI route, and an on-map layer controller
 * for route lines, stop markers and raw coordinate pins. All state is local:
 * no database or network calls beyond the OSM tiles.
 */
export default function MapLayerManager({
  route = null,
  rawCoordinates = [],
  savedRoutes = [],
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className = "",
}: MapLayerManagerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupsRef = useRef<{
    route: L.LayerGroup;
    stops: L.LayerGroup;
    raw: L.LayerGroup;
    saved: L.LayerGroup;
  } | null>(null);
  const pinnedRef = useRef(false);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    route: true,
    stops: true,
    raw: true,
    saved: true,
  });

  const pathCount = route?.pathCoordinates?.length ?? 0;
  const stopCount = route?.stops?.length ?? 0;
  const rawCount = rawCoordinates.length;
  const savedCount = savedRoutes.length;

  const routeLatLngs = useMemo<[number, number][]>(
    () => (route?.pathCoordinates ?? []).map(([lat, lng]) => [lat, lng] as [number, number]),
    [route],
  );

  // Create the map and its three layer groups once, on the client only.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center,
      zoom,
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: true,
      worldCopyJump: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);

    const groups = {
      route: L.layerGroup().addTo(map),
      stops: L.layerGroup().addTo(map),
      raw: L.layerGroup().addTo(map),
      saved: L.layerGroup().addTo(map),
    };

    mapRef.current = map;
    groupsRef.current = groups;
    pinnedRef.current = false;

    map.on("click", () => {
      pinnedRef.current = false;
    });

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);
    map.invalidateSize();

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      groupsRef.current = null;
    };
    // `center`/`zoom` are initial values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild every layer whenever the route data or raw pins change.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const map = mapRef.current;
    const groups = groupsRef.current;
    if (!map || !groups) return;

    groups.route.clearLayers();
    groups.stops.clearLayers();
    groups.raw.clearLayers();
    groups.saved.clearLayers();

    /** Hover previews the card, click pins it open until the map is clicked. */
    const attachCard = (layer: InteractiveLayer, html: string) => {
      layer.bindPopup(html, { className: "mlm-popup", maxWidth: 300, minWidth: 200 });
      layer.on("mouseover", () => layer.openPopup());
      layer.on("mouseout", () => {
        if (!pinnedRef.current) layer.closePopup();
      });
      layer.on("click", () => {
        pinnedRef.current = true;
        layer.openPopup();
      });
    };

    // 1. Route polyline: blurred halo + crisp core.
    if (routeLatLngs.length >= 2) {
      const glow = L.polyline(routeLatLngs, {
        color: ROUTE_COLOR,
        weight: 14,
        opacity: 0.18,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(groups.route);
      applyFilter(glow, "blur(6px)");

      const core = L.polyline(routeLatLngs, {
        color: ROUTE_COLOR,
        weight: 3,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 1,
      }).addTo(groups.route);
      applyFilter(core, `drop-shadow(0 0 5px ${ROUTE_COLOR})`);
      attachCard(core, buildRouteCard(route));
    }

    // 2. Stop markers with their own card, highlighting the clicked stop.
    (route?.stops ?? []).forEach((stop, index) => {
      const marker = L.marker([stop.lat, stop.lng], {
        icon: createStopIcon(ROUTE_COLOR),
        title: stop.name,
        riseOnHover: true,
        keyboard: true,
      }).addTo(groups.stops);

      marker.bindTooltip(escapeHtml(stop.name), {
        permanent: true,
        direction: "top",
        className: "mlm-tooltip",
        opacity: 1,
      });
      attachCard(marker, buildRouteCard(route, index));
    });

    // 3. Raw, unnormalized coordinate pins.
    rawCoordinates.forEach(([lat, lng], index) => {
      const pin = L.circleMarker([lat, lng], {
        radius: 5,
        color: RAW_COLOR,
        weight: 1.5,
        fillColor: RAW_COLOR,
        fillOpacity: 0.85,
        opacity: 0.9,
      }).addTo(groups.raw);

      pin.bindTooltip(`Raw ${index + 1}`, {
        direction: "top",
        className: "mlm-tooltip",
        opacity: 1,
      });
      attachCard(pin, buildRawCard(lat, lng, index));
    });

    // 4. Saved routes handed in by the host (e.g. rows from Supabase).
    savedRoutes.forEach((saved) => {
      const latlngs: [number, number][] = saved.geometry?.coordinates?.length
        ? saved.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
        : (saved.coordinates ?? []);
      if (latlngs.length < 2) return;

      const line = L.polyline(latlngs, {
        color: saved.color ?? SAVED_COLOR,
        weight: 2.5,
        opacity: 0.85,
        dashArray: "6 7",
        lineCap: "round",
        lineJoin: "round",
      }).addTo(groups.saved);

      if (saved.name) {
        line.bindTooltip(escapeHtml(saved.name), {
          sticky: true,
          direction: "top",
          className: "mlm-tooltip",
          opacity: 1,
        });
      }
    });

    // Apply the controller's visibility state after every rebuild.
    (Object.keys(groups) as LayerKey[]).forEach((key) => {
      if (layers[key]) groups[key].addTo(map);
      else map.removeLayer(groups[key]);
    });
  }, [route, routeLatLngs, rawCoordinates, savedRoutes, layers]);

  // Smoothly frame the whole AI route whenever a new one arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = L.latLngBounds([]);
    (route?.pathCoordinates ?? []).forEach(([lat, lng]) => bounds.extend([lat, lng]));
    (route?.stops ?? []).forEach((stop) => bounds.extend([stop.lat, stop.lng]));
    savedRoutes.forEach((saved) => {
      if (saved.geometry?.coordinates?.length) {
        saved.geometry.coordinates.forEach(([lng, lat]) => bounds.extend([lat, lng]));
      }
      (saved.coordinates ?? []).forEach(([lat, lng]) => bounds.extend([lat, lng]));
    });

    if (!bounds.isValid()) {
      // No AI route yet: fall back to the user's raw pins.
      rawCoordinates.forEach(([lat, lng]) => bounds.extend([lat, lng]));
    }
    if (!bounds.isValid()) return;

    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom: 16,
      animate: true,
      duration: 0.8,
    });
  }, [route, rawCoordinates, savedRoutes]);

  const toggleLayer = (key: LayerKey) => setLayers((current) => ({ ...current, [key]: !current[key] }));

  const controls: { key: LayerKey; label: string; count: number }[] = [
    { key: "route", label: "Route line", count: pathCount },
    { key: "stops", label: "Stops", count: stopCount },
    { key: "raw", label: "Raw pins", count: rawCount },
    { key: "saved", label: "Saved", count: savedCount },
  ];

  return (
    <div className={`mlm-container relative h-full min-h-[320px] w-full overflow-hidden ${className}`}>
      <div ref={containerRef} className="h-full min-h-[320px] w-full" />

      {/* Layer controller — purely client-side visibility state. */}
      <div className="absolute top-3 right-3 z-[500] flex flex-col items-end gap-2">
        <div
          role="group"
          aria-label="Map layers"
          className="flex flex-wrap items-center justify-end gap-1 rounded-full border border-cyan-500/30 bg-[#050b14]/90 p-1 backdrop-blur"
        >
          {controls.map((control) => {
            const active = layers[control.key];
            return (
              <button
                key={control.key}
                type="button"
                aria-pressed={active}
                disabled={control.count === 0}
                onClick={() => toggleLayer(control.key)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium tracking-[0.08em] uppercase transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "bg-cyan-400/20 text-cyan-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-[#00f3ff] shadow-[0_0_6px_#00f3ff]" : "bg-slate-600"
                  }`}
                />
                {control.label}
                <span className="text-slate-500">{control.count}</span>
              </button>
            );
          })}
        </div>
        <span className="rounded-full border border-cyan-500/15 bg-[#050b14]/80 px-2 py-0.5 text-[9px] tracking-[0.15em] text-slate-500 uppercase">
          Local layers · no database
        </span>
      </div>

      <style>{`
        .mlm-container .leaflet-container {
          height: 100%;
          width: 100%;
          background: #050b14;
          font-family: inherit;
          outline: none;
        }
        .mlm-container .leaflet-tile-pane {
          filter: saturate(0.35) brightness(0.72) contrast(1.05);
        }
        .mlm-container .leaflet-bar,
        .mlm-container .leaflet-bar a {
          background: rgba(5, 11, 20, 0.9);
          color: #7ff6ff;
          border-color: rgba(0, 243, 255, 0.3);
        }
        .mlm-container .leaflet-bar a:hover {
          background: rgba(0, 243, 255, 0.15);
          color: #e6ffff;
        }
        .mlm-container .leaflet-control-attribution {
          background: rgba(5, 11, 20, 0.75);
          color: #6d8fa6;
          font-size: 10px;
        }
        .mlm-container .leaflet-control-attribution a { color: #7ff6ff; }
        .mlm-container .mlm-pin { background: transparent; border: none; }
        .mlm-tooltip.leaflet-tooltip {
          background: rgba(5, 11, 20, 0.88);
          border: 1px solid rgba(0, 243, 255, 0.45);
          color: #d9fbff;
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 11px;
          letter-spacing: 0.04em;
          box-shadow: 0 0 14px rgba(0, 243, 255, 0.25);
          backdrop-filter: blur(6px);
        }
        .mlm-tooltip.leaflet-tooltip-top::before {
          border-top-color: rgba(0, 243, 255, 0.45);
        }
        .mlm-popup.leaflet-popup .leaflet-popup-content-wrapper {
          background: rgba(5, 11, 20, 0.96);
          border: 1px solid rgba(0, 243, 255, 0.35);
          color: #d9fbff;
          border-radius: 12px;
          box-shadow: 0 0 24px rgba(0, 243, 255, 0.22);
          backdrop-filter: blur(10px);
        }
        .mlm-popup.leaflet-popup .leaflet-popup-content { margin: 12px 14px; }
        .mlm-popup.leaflet-popup .leaflet-popup-tip {
          background: rgba(5, 11, 20, 0.96);
          border: 1px solid rgba(0, 243, 255, 0.35);
        }
        .mlm-popup.leaflet-popup a.leaflet-popup-close-button { color: #6d8fa6; }
        .mlm-card { min-width: 190px; font-size: 12px; }
        .mlm-card__eyebrow {
          margin: 0 0 2px;
          color: #5f7d91;
          font-size: 9px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }
        .mlm-card__title {
          margin: 0 0 8px;
          color: #e6ffff;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.35;
        }
        .mlm-card__meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .mlm-card__meta span {
          display: inline-flex;
          gap: 5px;
          align-items: baseline;
          border: 1px solid rgba(0, 243, 255, 0.2);
          border-radius: 6px;
          padding: 2px 6px;
          font-size: 10px;
          color: #d9fbff;
        }
        .mlm-card__meta b {
          color: #5f7d91;
          font-size: 8px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .mlm-card__stops {
          margin: 0;
          padding: 0;
          list-style: none;
          max-height: 168px;
          overflow-y: auto;
        }
        .mlm-stop {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          padding: 3px 0;
          color: #a9c6d8;
          line-height: 1.4;
        }
        .mlm-stop.is-active { color: #e6ffff; }
        .mlm-stop__index {
          flex: 0 0 auto;
          width: 16px;
          height: 16px;
          margin-top: 1px;
          border-radius: 999px;
          border: 1px solid rgba(0, 243, 255, 0.35);
          color: #7ff6ff;
          font-size: 9px;
          line-height: 14px;
          text-align: center;
        }
        .mlm-stop.is-active .mlm-stop__index {
          background: rgba(0, 243, 255, 0.2);
          border-color: rgba(0, 243, 255, 0.7);
        }
        .mlm-card__empty {
          margin: 0;
          color: #5f7d91;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
