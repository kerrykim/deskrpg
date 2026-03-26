"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

export interface NpcChatMessage {
  role: "player" | "npc";
  content: string;
}

interface NpcDialogProps {
  npcName: string;
  messages: NpcChatMessage[];
  isStreaming: boolean;
  onSend: (message: string) => void;
  onClose: () => void;
}

const MAX_MESSAGE_LENGTH = 500;
const COOLDOWN_MS = 2000;

export default function NpcDialog({
  npcName,
  messages,
  isStreaming,
  onSend,
  onClose,
}: NpcDialogProps) {
  const t = useT();
  const [input, setInput] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || cooldown || isStreaming) return;

    setInput("");
    onSend(trimmed);

    // Start cooldown
    setCooldown(true);
    setTimeout(() => setCooldown(false), COOLDOWN_MS);
  }, [input, cooldown, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim().length > 0 && !cooldown && !isStreaming;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
      <div className="w-full max-w-[800px] pointer-events-auto">
        {/* Dialog box */}
        <div className="bg-gray-900 border-t-2 border-x-2 border-amber-500 rounded-t-lg shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800 rounded-t-lg">
            <div className="flex items-center gap-3">
              {/* NPC portrait placeholder */}
              <div className="w-10 h-10 rounded-full bg-amber-700 flex items-center justify-center text-white font-bold text-lg">
                {npcName[0]}
              </div>
              <span className="text-amber-400 font-bold text-lg">{npcName}</span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white px-2 py-1 text-sm"
              title={t("common.closeEsc")}
            >
              ESC
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="h-48 overflow-y-auto px-4 py-3 space-y-2"
          >
            {messages.length === 0 && (
              <div className="text-gray-500 text-sm italic">
                {t("chat.npcPlaceholder", { name: npcName })}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "player" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                    msg.role === "player"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-700 text-gray-100"
                  }`}
                >
                  {msg.content}
                  {msg.role === "npc" && isStreaming && i === messages.length - 1 && (
                    <span className="inline-block w-1.5 h-4 bg-amber-400 ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-700">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              onKeyDown={handleKeyDown}
              placeholder={cooldown ? t("chat.cooldown") : t("chat.npcPlaceholder", { name: npcName })}
              className="flex-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-600 focus:border-amber-500 focus:outline-none text-sm"
              disabled={isStreaming}
              maxLength={MAX_MESSAGE_LENGTH}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`px-4 py-2 rounded font-semibold text-sm transition ${
                canSend
                  ? "bg-amber-500 hover:bg-amber-600 text-black"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              {t("common.send")}
            </button>
            {input.length > 400 && (
              <span className="text-xs text-gray-500">
                {input.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
