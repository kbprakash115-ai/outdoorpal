"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chat-store";

interface MapViewProps {
  message: ChatMessage | null;
  height?: number;
}

interface LMarker {
  lat: number;
  lon: number;
  name: string;
  rank?: number;
  ok?: boolean;
  isOrigin?: boolean;
}

export default function MapView({ message, height = 360 }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Initialise Leaflet on the client only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      // CSS for Leaflet 1.9
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      // Wait one tick so CSS is applied before sizing.
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        zoomControl: true,
      }).setView([19.076, 72.8777], 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      // Make sure leaflet knows about its size
      setTimeout(() => map.invalidateSize(), 100);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Update markers + view whenever the message changes
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    // Clear previous markers
    for (const m of markersRef.current) {
      try { map.removeLayer(m); } catch {}
    }
    markersRef.current = [];

    const markers: LMarker[] = [];
    if (message?.origin) {
      markers.push({
        lat: message.origin.lat,
        lon: message.origin.lon,
        name: message.origin.name?.split(",").slice(0, 2).join(", ") || "Origin",
        isOrigin: true,
      });
    }
    if (message?.recommendations?.length) {
      for (const r of message.recommendations) {
        markers.push({
          lat: r.venue_lat,
          lon: r.venue_lon,
          name: r.venue_name,
          rank: r.rank,
          ok: r.ok,
        });
      }
    }
    if (!markers.length) return;

    let L: any = (window as any).L;
    if (!L) return;

    for (const m of markers) {
      const isOrigin = !!m.isOrigin;
      const icon = L.divIcon({
        className: "",
        html: isOrigin
          ? `<div style="background:#0ea5e9;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.3)">★</div>`
          : m.ok === false
            ? `<div style="background:#ef4444;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.3)">${m.rank ?? "•"}</div>`
            : `<div style="background:#16a34a;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.3)">${m.rank ?? "•"}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([m.lat, m.lon], { icon }).addTo(map);
      marker.bindPopup(
        `<div style="font-family:system-ui,sans-serif"><b>${escapeHtml(m.name)}</b><br/><span style="font-size:11px;color:#555">${m.isOrigin ? "Your starting point" : `Rank #${m.rank} · ${m.ok === false ? "blocked" : "recommended"}`}</span></div>`
      );
      markersRef.current.push(marker);
    }

    // Fit bounds to all markers
    const latLons = markers.map((m) => [m.lat, m.lon] as [number, number]);
    if (latLons.length === 1) {
      map.setView(latLons[0], 12);
    } else if (latLons.length > 1) {
      try {
        const bounds = L.latLngBounds(latLons);
        map.fitBounds(bounds, { padding: [40, 40] });
      } catch {}
    }
  }, [message]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid hsl(var(--border))",
        background: "#e5e7eb",
      }}
      aria-label="Map of recommended venues"
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
