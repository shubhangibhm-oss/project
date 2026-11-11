import GhostMap from "@/components/GhostMap";
import type { GhostRoute, GhostStop } from "@/components/GhostMap";

const routes: GhostRoute[] = [
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
    id: "cubbon-loop",
    name: "Cubbon Park Loop",
    geometry: {
      type: "LineString",
      // GeoJSON order: [longitude, latitude]
      coordinates: [
        [77.5929, 12.9763],
        [77.585, 12.976],
        [77.58, 12.97],
        [77.59, 12.965],
        [77.598, 12.97],
        [77.5929, 12.9763],
      ],
    },
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

const stops: GhostStop[] = [
  { id: "mg-road", name: "MG Road Metro", latitude: 12.9756, longitude: 77.6068, description: "Purple Line interchange." },
  { id: "cubbon", name: "Cubbon Park", latitude: 12.9763, longitude: 77.5929, description: "Green canopy pickup point." },
  { id: "vidhana", name: "Vidhana Soudha", latitude: 12.9794, longitude: 77.5907 },
  { id: "indiranagar", name: "Indiranagar", latitude: 12.9784, longitude: 77.6408, description: "100 Feet Road drop-off." },
  { id: "koramangala", name: "Koramangala", latitude: 12.9352, longitude: 77.6245, color: "#7cf6a0" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] tracking-[0.35em] text-cyan-400/70 uppercase">Ghost Routes</p>
        <h1 className="text-2xl font-semibold text-cyan-50 sm:text-3xl">AI + Maps module</h1>
        <p className="text-sm text-slate-400">
          Live Leaflet canvas · {routes.length} routes · {stops.length} stops
        </p>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="h-[60vh] min-h-[360px] overflow-hidden rounded-2xl border border-cyan-500/25 shadow-[0_0_40px_-12px_rgba(0,243,255,0.55)] lg:h-[calc(100dvh-11rem)]">
          <GhostMap routes={routes} stops={stops} />
        </div>

        <aside className="rounded-2xl border border-cyan-500/20 bg-[#050b14]/80 p-4">
          <h2 className="text-xs tracking-[0.2em] text-cyan-300/80 uppercase">Stops</h2>
          <ul className="mt-3 space-y-2">
            {stops.map((stop) => (
              <li key={stop.id} className="flex items-start gap-2 text-sm text-slate-300">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: stop.color ?? "#00f3ff", boxShadow: `0 0 8px ${stop.color ?? "#00f3ff"}` }}
                />
                <span>
                  {stop.name}
                  <span className="block text-[11px] text-slate-500">
                    {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
