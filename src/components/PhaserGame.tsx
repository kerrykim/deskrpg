"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { EventBus } from "@/game/EventBus";
import { compositeCharacter } from "@/lib/sprite-compositor";
import type {
  CharacterAppearance,
  LegacyCharacterAppearance,
} from "@/lib/lpc-registry";
import type { Socket } from "socket.io-client";

interface PhaserGameProps {
  spritesheetDataUrl: string;
  socket: Socket | null;
  characterId: string;
  characterName: string;
  appearance: CharacterAppearance | LegacyCharacterAppearance;
}

export default function PhaserGame({
  spritesheetDataUrl,
  socket,
  characterId,
  characterName,
  appearance,
}: PhaserGameProps) {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spritesheetRef = useRef(spritesheetDataUrl);
  const socketRef = useRef(socket);
  const characterRef = useRef({ characterId, characterName, appearance });

  // Keep refs in sync
  spritesheetRef.current = spritesheetDataUrl;
  socketRef.current = socket;
  characterRef.current = { characterId, characterName, appearance };

  useLayoutEffect(() => {
    if (gameRef.current || !containerRef.current) return;

    // Ensure localStorage is accessible — Phaser accesses it internally.
    // In restricted contexts (Cloudflare, privacy mode), provide a no-op fallback.
    try {
      localStorage.getItem("__test__");
    } catch {
      // localStorage blocked — install in-memory fallback to prevent Phaser errors
      const memStore: Record<string, string> = {};
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k: string) => memStore[k] ?? null,
          setItem: (k: string, v: string) => { memStore[k] = v; },
          removeItem: (k: string) => { delete memStore[k]; },
          clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
          get length() { return Object.keys(memStore).length; },
          key: (i: number) => Object.keys(memStore)[i] ?? null,
        },
        writable: true,
        configurable: true,
      });
    }

    // Dynamically import to avoid SSR issues with Phaser
    import("@/game/main").then(({ createGame }) => {
      if (gameRef.current) return; // Guard against double-invoke in StrictMode

      const game = createGame("game-container");
      gameRef.current = game;

      // When the GameScene is ready, send the spritesheet
      const onSceneReady = () => {
        EventBus.emit("spritesheet-ready", spritesheetRef.current);
      };
      EventBus.on("scene-ready", onSceneReady);

      // Send socket info whenever requested or when player spawns
      const emitSocketIfReady = () => {
        if (socketRef.current) {
          const c = characterRef.current;
          EventBus.emit("socket-ready", {
            socket: socketRef.current,
            characterId: c.characterId,
            characterName: c.characterName,
            appearance: c.appearance,
          });
        }
      };
      EventBus.on("player-spawned", emitSocketIfReady);
      EventBus.on("request-socket", emitSocketIfReady);

      // Remote player compositing requests from GameScene
      const onCompositeRemote = async (data: {
        id: string;
        appearance: CharacterAppearance | LegacyCharacterAppearance;
        textureKey?: string;
      }) => {
        try {
          const canvas = document.createElement("canvas");
          await compositeCharacter(canvas, data.appearance);
          const dataUrl = canvas.toDataURL("image/png");
          EventBus.emit("remote-spritesheet-ready", {
            id: data.id,
            textureKey: data.textureKey || `remote-${data.id}`,
            dataUrl,
          });
        } catch (err) {
          console.error("Failed to composite remote player:", data.id, err);
        }
      };
      EventBus.on("composite-remote-player", onCompositeRemote);
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      EventBus.removeAllListeners();
    };
  }, []);

  // If the spritesheet changes after initial load, re-send it
  useEffect(() => {
    if (!spritesheetDataUrl) return;
    EventBus.emit("spritesheet-ready", spritesheetDataUrl);
  }, [spritesheetDataUrl]);

  // If socket becomes available after game init, send it
  useEffect(() => {
    if (!socket) return;
    // If player already spawned, emit socket-ready now
    const c = characterRef.current;
    EventBus.emit("socket-ready", {
      socket,
      characterId: c.characterId,
      characterName: c.characterName,
      appearance: c.appearance,
    });
  }, [socket]);

  return (
    <div
      id="game-container"
      ref={containerRef}
      className="fixed inset-0 z-0"
    />
  );
}
