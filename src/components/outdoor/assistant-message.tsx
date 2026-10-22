"use client";

import React from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown, MapPin, Clock, Wind, Droplets, Sun, Gauge, Car } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-store";

const Markdown = React.lazy(() => import("react-markdown"));

function Loader() {
  return <div className="text-sm text-muted-foreground">loading markdown…</div>;
}

export function AssistantMessage({ message }: { message: ChatMessage }) {
  if (message.pending) {
    return (
      <Card className="border-amber-300/40">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Fetching live data from Nominatim, Overpass, Open-Meteo, OSRM…</span>
          </div>
          <div className="space-y-1">
            <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
            <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
            <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (message.error) {
    return (
      <Card className="border-rose-400/60">
        <CardContent className="p-4 text-sm text-rose-600">
          ⚠️ {message.error}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">Assistant</CardTitle>
          <Badge variant={message.generator === "slm" ? "default" : "secondary"}>
            {message.generator === "slm" ? "SLM-generated" : "template (grounded)"}
          </Badge>
          {message.elapsedMs && (
            <Badge variant="outline" className="text-xs">
              {message.elapsedMs.toLocaleString()} ms
            </Badge>
          )}
          {message.model && (
            <Badge variant="outline" className="text-xs font-mono">
              {message.model.split("/").pop()}
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Recommendation grounded in live data. SLM only naturalises the prose.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <React.Suspense fallback={<Loader />}>
            <Markdown>{message.answer || ""}</Markdown>
          </React.Suspense>
        </div>

        {message.recommendations && message.recommendations.length > 0 && (
          <Separator />
        )}
        {message.recommendations && message.recommendations.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Top-ranked slots</h4>
            <div className="grid gap-2">
              {message.recommendations.map((r: any) => (
                <SlotCard key={r.rank} r={r} />
              ))}
            </div>
          </div>
        )}

        {message.dataSources && message.dataSources.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="w-3 h-3" />
              Data sources ({message.dataSources.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 space-y-1 text-xs">
                {message.dataSources.map((d: any) => (
                  <li key={d.name}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 dark:text-sky-400 underline">
                      {d.name}
                    </a>{" "}
                    — {d.note}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function SlotCard({ r }: { r: any }) {
  const w = r.weather || {};
  const aq = r.air_quality;
  return (
    <Card className={r.ok ? "border-green-500/40" : "border-rose-500/40"}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant={r.ok ? "default" : "destructive"}>
              #{r.rank} {r.ok ? "Go" : "Blocked"}
            </Badge>
            <span className="font-semibold text-sm">{r.venue_name}</span>
            <Badge variant="outline" className="text-[10px]">{r.venue_type}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {r.venue_distance_m ? `${(r.venue_distance_m / 1000).toFixed(1)} km · ` : ""}
            {r.travel_min ? `${r.travel_min} min by road` : "no routing"}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span><Clock className="inline w-3 h-3 mr-1" />{r.slot_time_local}</span>
          <span><MapPin className="inline w-3 h-3 mr-1" />{r.venue_lat?.toFixed(3)}, {r.venue_lon?.toFixed(3)}</span>
        </div>
        <Progress value={r.score} className="h-1.5" />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span title="Apparent temperature"><Gauge className="inline w-3 h-3 mr-1" />{w.feels_like_c}°C</span>
          <span title="Wind / gust"><Wind className="inline w-3 h-3 mr-1" />{w.wind_kph} kph{w.gust_kph > w.wind_kph + 5 ? ` (g${w.gust_kph})` : ""}</span>
          <span title="Precipitation"><Droplets className="inline w-3 h-3 mr-1" />{w.precip_prob}% · {w.precip_mm} mm</span>
          <span title="UV index"><Sun className="inline w-3 h-3 mr-1" />UV {w.uv_index}</span>
          <span title="Humidity"><Droplets className="inline w-3 h-3 mr-1" />{w.humidity}%</span>
          {aq && <span title="AQI">AQI {aq.european_aqi} · PM2.5 {aq.pm25?.toFixed(0)}</span>}
          {r.travel_min != null && r.travel_min > 0 && (
            <span title="Travel time"><Car className="inline w-3 h-3 mr-1" />{r.travel_min} min</span>
          )}
        </div>
        {r.blockers?.length > 0 && (
          <div className="text-xs text-rose-600 dark:text-rose-400">
            ⚠️ {r.blockers.join("; ")}
          </div>
        )}
        {r.reasons?.length > 0 && (
          <div className="text-xs text-emerald-700 dark:text-emerald-400">
            ✓ {r.reasons.join("; ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
