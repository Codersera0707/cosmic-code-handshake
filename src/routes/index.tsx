import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CosmicIntro } from "@/components/intro/CosmicIntro";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cosmic Intro — Business × Intelligence in Code" },
      {
        name: "description",
        content:
          "A pure-code canvas intro: rays of light braid into business and a mind, clasp into a handshake, drain into a diamond and burst.",
      },
      { property: "og:title", content: "Cosmic Intro — Business × Intelligence in Code" },
      {
        property: "og:description",
        content: "Light, math and particles: a developer's identity told through canvas code.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [run, setRun] = useState(0);
  const [ended, setEnded] = useState(false);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background">
      <h1 className="sr-only">Business and intelligence, joined in code</h1>
      <CosmicIntro key={run} onComplete={() => setEnded(true)} />
      {ended && (
        <button
          type="button"
          onClick={() => {
            setEnded(false);
            setRun((r) => r + 1);
          }}
          className="btn-hud animate-hud-in absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          ↻ replay
        </button>
      )}
    </main>
  );
}
