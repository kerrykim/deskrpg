"use client";

import { useEffect, useRef } from "react";
import { EventBus } from "@/game/EventBus";
import type { MapObject } from "@/lib/object-types";

interface MapEditorPhaserProps {
  mapData: {
    layers: { floor: number[][]; walls: number[][] };
    objects: MapObject[];
  };
  cols: number;
  rows: number;
  spawnCol: number;
  spawnRow: number;
  onTileChanged?: (data: { layer: string; col: number; row: number; prev: number; next: number }) => void;
  onObjectsChanged?: (data: { prev: MapObject[]; next: MapObject[] }) => void;
  onSpawnChanged?: (data: { col: number; row: number; prevCol: number; prevRow: number }) => void;
  onFillApplied?: (data: { layer: string; count: number }) => void;
}

export default function MapEditorPhaser({
  mapData, cols, rows, spawnCol, spawnRow,
  onTileChanged, onObjectsChanged, onSpawnChanged, onFillApplied,
}: MapEditorPhaserProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const mapLoadedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    import("@/game/editor-main").then(({ createEditorGame }) => {
      const game = createEditorGame("map-editor-canvas", width, height);
      gameRef.current = game;

      EventBus.on("editor:scene-ready", () => {
        if (!mapLoadedRef.current) {
          mapLoadedRef.current = true;
          EventBus.emit("editor:load-map", { layers: mapData.layers, objects: mapData.objects, cols, rows, spawnCol, spawnRow });
        }
      });
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      mapLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleTile = (data: { layer: string; col: number; row: number; prev: number; next: number }) => onTileChanged?.(data);
    const handleObj = (data: { prev: MapObject[]; next: MapObject[] }) => onObjectsChanged?.(data);
    const handleSpawn = (data: { col: number; row: number; prevCol: number; prevRow: number }) => onSpawnChanged?.(data);
    const handleFill = (data: { layer: string; count: number }) => onFillApplied?.(data);

    EventBus.on("editor:tile-changed", handleTile);
    EventBus.on("editor:objects-changed", handleObj);
    EventBus.on("editor:spawn-changed", handleSpawn);
    EventBus.on("editor:fill-applied", handleFill);

    return () => {
      EventBus.off("editor:tile-changed", handleTile);
      EventBus.off("editor:objects-changed", handleObj);
      EventBus.off("editor:spawn-changed", handleSpawn);
      EventBus.off("editor:fill-applied", handleFill);
    };
  }, [onTileChanged, onObjectsChanged, onSpawnChanged, onFillApplied]);

  return (
    <div ref={containerRef} id="map-editor-canvas" className="w-full h-full bg-[#1a1a2e]" onContextMenu={(e) => e.preventDefault()} />
  );
}
