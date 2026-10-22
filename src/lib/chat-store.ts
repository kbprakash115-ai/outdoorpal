"use client";

import { create } from "zustand";
import type { ReasonerOutput } from "@/lib/slm/reasoner";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  question: string;
  answer?: string;            // markdown
  answerText?: string;        // plain text
  generator?: string;         // "slm" | "template"
  model?: string;
  reasoner?: ReasonerOutput;
  elapsedMs?: number;
  pending?: boolean;
  error?: string;
  recommendations?: any[];
  origin?: { lat: number; lon: number; name: string } | null;
  dataSources?: any[];
}

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  send: (question: string) => Promise<void>;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  loading: false,
  send: async (question: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      question,
    };
    const asstMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      question,
      pending: true,
    };
    set((s) => ({ messages: [...s.messages, userMsg, asstMsg], loading: true }));

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      const j = await res.json();
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === asstMsg.id
            ? {
                ...m,
                pending: false,
                answer: j.answer,
                answerText: j.answer_text,
                generator: j.generator,
                model: j.model,
                reasoner: j.reasoner,
                elapsedMs: j.elapsed_ms,
                recommendations: j.reasoner?.recommendations,
                origin: j.reasoner?.origin,
                dataSources: j.data_sources,
              }
            : m
        ),
        loading: false,
      }));
    } catch (e: any) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === asstMsg.id
            ? { ...m, pending: false, error: e?.message || "request failed" }
            : m
        ),
        loading: false,
      }));
    }
  },
  clear: () => set({ messages: [] }),
}));
