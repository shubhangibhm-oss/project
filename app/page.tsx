import GhostRouteStudio from "@/components/GhostRouteStudio";

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

      <GhostRouteStudio />
    </main>
  );
}
