"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore, ChatMessage } from "@/lib/chat-store";
import dynamic from "next/dynamic";
import {
  Activity, Send, Sparkles, Wind, Map as MapIcon, AlertTriangle, Trash2,
  Send as SendIcon,
} from "lucide-react";
import { AssistantMessage } from "@/components/outdoor/assistant-message";

const MapView = dynamic(() => import("@/components/outdoor/map-view"), { ssr: false });

const EXAMPLE_QUERIES = [
  "Where can I go running tomorrow evening near Koregaon Park?",
  "Best time this weekend for a kids' cricket match within 15 km of Whitefield?",
  "I have mild asthma, where's good for a morning walk near Powai in the next two days?",
  "Is it okay to cycle to work at 8 AM near Hinjewadi?",
  "Planning an outdoor birthday party on Sunday afternoon in Pune, what should I keep in mind?",
  "Good place and time for golf on Saturday within 40 km of Andheri?",
  "Where can I take sunset photos this evening around Bandra?",
  "Is Saturday or Sunday better for a hike near Lonavala?",
  "Outdoor tennis after work today near Hinjewadi, any good spots?",
  "When is it safe for my parents (seniors) to walk outdoors tomorrow near Bengaluru?",
];

const ACTIVITY_LABELS = [
  { key: "running", label: "Running", emoji: "🏃" },
  { key: "cycling", label: "Cycling", emoji: "🚴" },
  { key: "golf", label: "Golf", emoji: "⛳" },
  { key: "cricket", label: "Cricket", emoji: "🏏" },
  { key: "football", label: "Football", emoji: "⚽" },
  { key: "tennis", label: "Tennis", emoji: "🎾" },
  { key: "hiking", label: "Hiking", emoji: "🥾" },
  { key: "picnic", label: "Picnic", emoji: "🧺" },
  { key: "event", label: "Event", emoji: "🎪" },
  { key: "photography", label: "Photography", emoji: "📷" },
];

export default function Home() {
  const { messages, send, loading, clear } = useChatStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsg = messages[messages.length - 1];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, loading]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    await send(q);
  };

  const pickExample = (q: string) => {
    setInput(q);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50 via-white to-sky-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="border-b border-border bg-white/70 dark:bg-slate-900/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold">
              <Wind className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                OutdoorPal
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                SLM-powered outdoor activity assistant · live weather + geospatial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              <Activity className="w-3 h-3 mr-1" />10 activities
            </Badge>
            <Badge variant="outline" className="text-xs">
              <Sparkles className="w-3 h-3 mr-1" />Qwen2.5-1.5B SLM
            </Badge>
            <Badge variant="outline" className="text-xs">
              <MapIcon className="w-3 h-3 mr-1" />OSM · Open-Meteo · OSRM
            </Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-4">
        {/* Chat column */}
        <section className="flex flex-col gap-3 min-h-0">
          {/* Activity picker */}
          <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm">Quick start — tap an activity</CardTitle>
              <CardDescription className="text-xs">
                The assistant parses free-form text. Activity buttons pre-fill examples.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3 flex flex-wrap gap-2">
              {ACTIVITY_LABELS.map((a) => (
                <Button
                  key={a.key}
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => pickExample(exampleForActivity(a.key))}
                >
                  <span className="mr-1">{a.emoji}</span>{a.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          {/* Chat scroll area */}
          <Card className="flex-1 min-h-0 flex flex-col bg-white/60 dark:bg-slate-900/60 backdrop-blur">
            <CardHeader className="pb-2 pt-3 flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Conversation</CardTitle>
                <CardDescription className="text-xs">
                  Every answer is grounded in live data fetched at query time.
                </CardDescription>
              </div>
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clear} className="h-7 text-xs">
                  <Trash2 className="w-3 h-3 mr-1" /> Clear
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              <ScrollArea className="flex-1 min-h-0 max-h-[60vh] lg:max-h-none" >
                <div ref={scrollRef} className="space-y-3 pr-2 min-h-[200px]">
                  {messages.length === 0 && (
                    <EmptyState onPick={pickExample} />
                  )}
                  {messages
                    .filter((m) => m.role === "user")
                    .map((m, i) => {
                      const asst = messages[i * 2 + 1];
                      return (
                        <div key={m.id} className="space-y-2">
                          <UserMessage question={m.question} />
                          {asst && <AssistantMessage message={asst} />}
                        </div>
                      );
                    })}
                </div>
              </ScrollArea>

              {/* Composer */}
              <form onSubmit={onSubmit} className="mt-3 flex gap-2 items-end">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder="Ask: where, when, and what to watch for…  (e.g. “Where can I go running tomorrow evening near Koregaon Park?”)"
                  rows={2}
                  disabled={loading}
                  className="resize-none text-sm"
                />
                <Button type="submit" disabled={loading || !input.trim()} className="h-12">
                  <SendIcon className="w-4 h-4" />
                  <span className="sr-only">Send</span>
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        {/* Right column: map + citations */}
        <aside className="flex flex-col gap-3 min-h-0">
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapIcon className="w-4 h-4" /> Live map
              </CardTitle>
              <CardDescription className="text-xs">
                {lastMsg?.origin ? "Origin and candidate venues" : "Send a question to populate the map"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <MapView message={lastMsg} height={360} />
              {lastMsg?.origin && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <strong>Origin:</strong> {lastMsg.origin.name?.split(",").slice(0, 2).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Pipeline
              </CardTitle>
              <CardDescription className="text-xs">
                Live-data steps the assistant runs for every question
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-3 text-xs space-y-1.5">
              <PipelineRow step="1" name="Parse query" tag="parser" />
              <PipelineRow step="2" name="Geocode location" tag="Nominatim" />
              <PipelineRow step="3" name="Find venues" tag="Overpass · OSM" />
              <PipelineRow step="4" name="Fetch weather + AQ" tag="Open-Meteo" />
              <PipelineRow step="5" name="Travel time" tag="OSRM" />
              <PipelineRow step="6" name="Score venue × hour" tag="rule engine" />
              <PipelineRow step="7" name="Naturalise with SLM" tag="Qwen2.5-1.5B" />
            </CardContent>
          </Card>
        </aside>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-white/60 dark:bg-slate-900/60 backdrop-blur py-3">
        <div className="max-w-7xl mx-auto px-4 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 justify-between">
          <div>
            Built for the GeoAI Hackathon @ CSRE, IIT Bombay · SLM: Qwen2.5-1.5B-Instruct (open-weights, ≤3B params)
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span>Data:</span>
            <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
            <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>
            <a className="underline" href="https://router.project-osrm.org/" target="_blank" rel="noopener noreferrer">OSRM</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PipelineRow({ step, name, tag }: { step: string; name: string; tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
        {step}
      </span>
      <span className="flex-1">{name}</span>
      <Badge variant="outline" className="text-[10px] font-mono">{tag}</Badge>
    </div>
  );
}

function UserMessage({ question }: { question: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-emerald-600 text-white px-3 py-2 text-sm shadow-sm">
        {question}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="space-y-3 py-6">
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 items-center justify-center text-2xl mb-2">
          🌤️
        </div>
        <h3 className="text-base font-semibold">Ask me where and when to head outdoors</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          I parse your question, fetch live weather & geospatial data from OpenStreetMap
          and Open-Meteo, score candidate venue × hour pairs, and surface a grounded
          recommendation. Powered by a small open SLM (Qwen2.5-1.5B-Instruct).
        </p>
      </div>
      <Separator />
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Try one of these:</p>
        <div className="grid gap-1.5">
          {EXAMPLE_QUERIES.slice(0, 6).map((q) => (
            <button
              key={q}
              onClick={() => onPick(q)}
              className="text-left text-xs px-3 py-2 rounded-md border border-border bg-white/70 dark:bg-slate-900/70 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function exampleForActivity(key: string): string {
  const map: Record<string, string> = {
    running: "Where can I go running tomorrow evening near Koregaon Park?",
    cycling: "Is it okay to cycle to work at 8 AM near Hinjewadi?",
    golf: "Good place and time for golf on Saturday within 40 km of Andheri?",
    cricket: "Best time this weekend for a kids' cricket match within 15 km of Whitefield?",
    football: "Where can my friends play football on Saturday morning near Powai?",
    tennis: "Outdoor tennis after work today near Hinjewadi, any good spots?",
    hiking: "Is Saturday or Sunday better for a hike near Lonavala?",
    picnic: "Planning a picnic in a park on Sunday afternoon in Pune, what should I keep in mind?",
    event: "Planning an outdoor birthday party on Sunday afternoon in Pune, what should I keep in mind?",
    photography: "Where can I take sunset photos this evening around Bandra?",
  };
  return map[key] ?? "";
}
