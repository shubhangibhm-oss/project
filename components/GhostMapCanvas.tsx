"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GhostMapProps, GhostRoute, GhostStop } from "./ghost-map.types";

const DEFAULT_CENTER: [number, number] = [13.028, 77.545]; // Bengaluru
const DEFAULT_ZOOM = 13;
const DEFAULT_ROUTE_COLOR = "#00f3ff";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

/** Normalises a route into Leaflet's [lat, lng] order. */
function toLatLngs(route: GhostRoute): [number, number][] {
  if (route.geometry?.coordinates?.length) {
    // GeoJSON is [lng, lat].
    return route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
  }
  return (route.coordinates ?? []).map(([lat, lng]) => [lat, lng] as [number, number]);
}

/** Custom SVG pin, rendered through a Leaflet divIcon so it can carry a glow. */
function createStopIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "ghost-stop-pin",
    html: `
      <div style="filter: drop-shadow(0 0 6px ${color});">
        <svg width="30" height="40" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M15 38.5C15 38.5 28 23.2 28 14.2C28 7 22.2 1 15 1C7.8 1 2 7 2 14.2C2 23.2 15 38.5 15 38.5Z"
            fill="#050b14" stroke="${color}" stroke-width="2" />
          <circle cx="15" cy="14.2" r="4.6" fill="${color}" />
          <circle cx="15" cy="14.2" r="1.6" fill="#050b14" />
        </svg>
      </div>`,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -34],
    tooltipAnchor: [0, -36],
  });
}

/** Applies a CSS filter to a rendered SVG path (Leaflet paths are SVG elements). */
function applyFilter(layer: L.Path, value: string) {
  const element = layer.getElement();
  if (element instanceof SVGElement) {
    element.style.setProperty("filter", value);
  }
}

/** Two stacked strokes give the neon "glow" look without extra dependencies. */
function addGlowingRoute(group: L.LayerGroup, route: GhostRoute) {
  const latlngs = toLatLngs(route);
  if (latlngs.length < 2) return;

  const color = route.color ?? DEFAULT_ROUTE_COLOR;
  const label = route.name ? `<span class="ghost-route-label">${escapeHtml(route.name)}</span>` : "";

  const glow = L.polyline(latlngs, {
    color,
    weight: 14,
    opacity: 0.18,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  }).addTo(group);
  applyFilter(glow, "blur(6px)");

  const core = L.polyline(latlngs, {
    color,
    weight: 3,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    smoothFactor: 1,
  }).addTo(group);
  applyFilter(core, `drop-shadow(0 0 5px ${color})`);

  if (label) {
    core.bindTooltip(label, {
      sticky: true,
      direction: "top",
      className: "ghost-map-tooltip",
      opacity: 1,
    });
  }
}

function addStopMarker(group: L.LayerGroup, stop: GhostStop) {
  const color = stop.color ?? DEFAULT_ROUTE_COLOR;
  const marker = L.marker([stop.latitude, stop.longitude], {
    icon: createStopIcon(color),
    title: stop.name,
    riseOnHover: true,
    keyboard: true,
  }).addTo(group);

  marker.bindTooltip(escapeHtml(stop.name), {
    permanent: true,
    direction: "top",
    className: "ghost-map-tooltip",
    opacity: 1,
  });

  const description = stop.description
    ? `<p style="margin:6px 0 0;color:#8fb3c9;font-size:11px;line-height:1.5;">${escapeHtml(stop.description)}</p>`
    : "";
  marker.bindPopup(
    `<div style="min-width:120px;">
       <strong style="display:block;color:${color};font-size:12px;letter-spacing:0.04em;">${escapeHtml(stop.name)}</strong>
       ${description}
       <span style="display:block;margin-top:6px;color:#5f7d91;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;">
         ${stop.latitude.toFixed(4)}, ${stop.longitude.toFixed(4)}
       </span>
     </div>`,
    { className: "ghost-map-popup", closeButton: false },
  );
}

/**
 * The actual Leaflet canvas. Never imported by the server: `GhostMap.tsx`
 * loads it through `next/dynamic` with `ssr: false`.
 */
export default function GhostMapCanvas({
  routes = [],
  stops = [],
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className = "",
  fitToContent = false,
}: GhostMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Create the map once, on the client.
  useEffect(() => {
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

    const layerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    layerGroupRef.current = layerGroup;

    // Keep Leaflet in sync with container size (resize, orientation change,
    // sidebar collapse, etc.) so the map stays responsive.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);
    map.invalidateSize();

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // `center`/`zoom` are initial values only; the map is not recreated on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-draw routes and stops whenever the incoming data changes.
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    routes.forEach((route) => addGlowingRoute(group, route));
    stops.forEach((stop) => addStopMarker(group, stop));

    // Optionally frame the freshly rendered content (e.g. an AI-normalized route).
    if (fitToContent) {
      const bounds = L.latLngBounds([]);
      routes.forEach((route) => toLatLngs(route).forEach((point) => bounds.extend(point)));
      stops.forEach((stop) => bounds.extend([stop.latitude, stop.longitude]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
      }
    }
  }, [routes, stops, fitToContent]);

  return (
    <div className={`ghost-map-container relative h-full min-h-[320px] w-full overflow-hidden ${className}`}>
      <div ref={containerRef} className="h-full min-h-[320px] w-full" />

      {/* Scoped Leaflet skin: dark tiles, cyan chrome, glassy tooltips. */}
      <style>{`
        .ghost-map-container .leaflet-container {
          height: 100%;
          width: 100%;
          background: #050b14;
          font-family: inherit;
          outline: none;
        }
        .ghost-map-container .leaflet-tile-pane {
          filter: saturate(0.35) brightness(0.72) contrast(1.05);
        }
        .ghost-map-container .leaflet-bar,
        .ghost-map-container .leaflet-bar a {
          background: rgba(5, 11, 20, 0.9);
          color: #7ff6ff;
          border-color: rgba(0, 243, 255, 0.3);
        }
        .ghost-map-container .leaflet-bar a:hover {
          background: rgba(0, 243, 255, 0.15);
          color: #e6ffff;
        }
        .ghost-map-container .leaflet-control-attribution {
          background: rgba(5, 11, 20, 0.75);
          color: #6d8fa6;
          font-size: 10px;
        }
        .ghost-map-container .leaflet-control-attribution a { color: #7ff6ff; }
        .ghost-map-container .ghost-stop-pin { background: transparent; border: none; }
        .ghost-map-tooltip.leaflet-tooltip {
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
        .ghost-map-tooltip.leaflet-tooltip-top::before {
          border-top-color: rgba(0, 243, 255, 0.45);
        }
        .ghost-map-tooltip .ghost-route-label {
          color: #00f3ff;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 10px;
        }
        .ghost-map-popup.leaflet-popup .leaflet-popup-content-wrapper {
          background: rgba(5, 11, 20, 0.95);
          border: 1px solid rgba(0, 243, 255, 0.35);
          color: #d9fbff;
          border-radius: 10px;
          box-shadow: 0 0 22px rgba(0, 243, 255, 0.22);
          backdrop-filter: blur(8px);
        }
        .ghost-map-popup.leaflet-popup .leaflet-popup-content { margin: 10px 12px; }
        .ghost-map-popup.leaflet-popup .leaflet-popup-tip {
          background: rgba(5, 11, 20, 0.95);
          border: 1px solid rgba(0, 243, 255, 0.35);
        }
      `}</style>
    </div>
  );
}
