"use client";

import dynamic from "next/dynamic";
import type { GhostMapProps } from "./ghost-map.types";

/**
 * GhostMap — public entry point.
 *
 * Leaflet touches `window`/`document` at import time, so the real map lives in
 * GhostMapCanvas, which is pulled in with a client-only dynamic import
 * (`ssr: false`). That keeps the App Router happy during SSR/prerender while
 * still shipping a fully interactive map after hydration.
 */
const GhostMapCanvas = dynamic(() => import("./GhostMapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] w-full items-center justify-center rounded-xl border border-cyan-500/20 bg-[#050b14]">
      <span className="animate-pulse text-xs tracking-[0.3em] text-cyan-300/80 uppercase">
        Mapping ghost routes…
      </span>
    </div>
  ),
});

export default function GhostMap(props: GhostMapProps) {
  return <GhostMapCanvas {...props} />;
}

export type { GhostMapProps, GhostRoute, GhostStop, GhostRouteGeometry, LatLngTuple } from "./ghost-map.types";
