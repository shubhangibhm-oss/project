"use client";

import dynamic from "next/dynamic";

/**
 * Leaflet touches `window`/`document` at import time, so the entire interactive
 * studio — map canvas, Leaflet CSS, marker icons and plugins — is loaded on the
 * client only. `ssr: false` keeps those modules out of server rendering and out
 * of the prerendered HTML; only the placeholder below is produced on the server.
 */
const RouteAIStudio = dynamic(() => import("@/components/RouteAIStudio"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center rounded-2xl border border-cyan-500/20 bg-[#050b14]">
      <span className="animate-pulse text-xs tracking-[0.3em] text-cyan-300/80 uppercase">
        Loading ghost routes…
      </span>
    </div>
  ),
});

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] tracking-[0.35em] text-cyan-400/70 uppercase">Ghost Routes</p>
        <h1 className="text-2xl font-semibold text-cyan-50 sm:text-3xl">AI + Maps module</h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Type a route the way people actually describe it — or paste chaotic coordinates — and Gemini
          normalizes it into a clean stop list and road-following polyline. Flip between the raw input
          and the cleaned route to see what the model fixed.
        </p>
      </header>

      <RouteAIStudio />
    </main>
  );
}
