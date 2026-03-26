"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { EventBus } from "@/game/EventBus";
import type { MapObject } from "@/lib/object-types";
import { EditorHistory, type EditorAction } from "@/lib/map-editor-utils";
import MapEditorPalette from "@/components/MapEditorPalette";
import MapEditorToolbar from "@/components/MapEditorToolbar";
import { ArrowLeft, Save } from "lucide-react";

const MapEditorPhaser = dynamic(
  () => import("@/components/MapEditorPhaser"),
  { ssr: false }
);

type EditorTool = "paint" | "erase" | "fill" | "spawn";
type EditorLayer = "floor" | "walls" | "objects";

export default function MapEditorEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [icon, setIcon] = useState("🗺️");
  const [description, setDescription] = useState("");
  const [cols, setCols] = useState(15);
  const [rows, setRows] = useState(11);
  const [mapData, setMapData] = useState<{
    layers: { floor: number[][]; walls: number[][] };
    objects: MapObject[];
  } | null>(null);
  const [spawnCol, setSpawnCol] = useState(7);
  const [spawnRow, setSpawnRow] = useState(9);

  const [currentLayer, setCurrentLayer] = useState<EditorLayer>("floor");
  const [currentTool, setCurrentTool] = useState<EditorTool>("paint");
  const [selectedTileId, setSelectedTileId] = useState(1);
  const [selectedObjectType, setSelectedObjectType] = useState("desk");
  const [hoverCol, setHoverCol] = useState(-1);
  const [hoverRow, setHoverRow] = useState(-1);

  const historyRef = useRef(new EditorHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const mapDataRef = useRef(mapData);
  mapDataRef.current = mapData;

  useEffect(() => {
    fetch(`/api/map-templates/${id}`)
      .then((r) => r.json())
      .then((data) => {
        const t = data.template;
        setTemplateName(t.name);
        setIcon(t.icon);
        setDescription(t.description || "");
        setCols(t.cols);
        setRows(t.rows);
        setSpawnCol(t.spawnCol);
        setSpawnRow(t.spawnRow);
        const layers =
          typeof t.layers === "string" ? JSON.parse(t.layers) : t.layers;
        const objects =
          typeof t.objects === "string" ? JSON.parse(t.objects) : t.objects;
        setMapData({ layers, objects });
      })
      .finally(() => setLoading(false));
  }, [id]);

  const pushHistory = useCallback(
    (action: EditorAction) => {
      historyRef.current.push(action);
      setCanUndo(historyRef.current.canUndo);
      setCanRedo(historyRef.current.canRedo);
    },
    []
  );

  const handleTileChanged = useCallback(
    (data: {
      layer: string;
      col: number;
      row: number;
      prev: number;
      next: number;
    }) => {
      pushHistory({
        type: "tile",
        layer: data.layer as "floor" | "walls",
        col: data.col,
        row: data.row,
        prev: data.prev,
        next: data.next,
      });
    },
    [pushHistory]
  );

  const handleObjectsChanged = useCallback(
    (data: { prev: MapObject[]; next: MapObject[] }) => {
      pushHistory({ type: "objects", prev: data.prev, next: data.next });
      setMapData((prev) => (prev ? { ...prev, objects: data.next } : null));
    },
    [pushHistory]
  );

  const handleSpawnChanged = useCallback(
    (data: {
      col: number;
      row: number;
      prevCol: number;
      prevRow: number;
    }) => {
      pushHistory({
        type: "spawn",
        prev: { col: data.prevCol, row: data.prevRow },
        next: { col: data.col, row: data.row },
      });
      setSpawnCol(data.col);
      setSpawnRow(data.row);
    },
    [pushHistory]
  );

  const handleUndo = useCallback(() => {
    const action = historyRef.current.undo();
    if (!action) return;
    if (action.type === "tile") {
      EventBus.emit("editor:update-tile", {
        layer: action.layer,
        col: action.col,
        row: action.row,
        value: action.prev,
      });
    } else if (action.type === "objects") {
      EventBus.emit("editor:update-objects", { objects: action.prev });
      setMapData((prev) => (prev ? { ...prev, objects: action.prev } : null));
    } else if (action.type === "spawn") {
      EventBus.emit("editor:set-spawn", action.prev);
      setSpawnCol(action.prev.col);
      setSpawnRow(action.prev.row);
    }
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  const handleRedo = useCallback(() => {
    const action = historyRef.current.redo();
    if (!action) return;
    if (action.type === "tile") {
      EventBus.emit("editor:update-tile", {
        layer: action.layer,
        col: action.col,
        row: action.row,
        value: action.next,
      });
    } else if (action.type === "objects") {
      EventBus.emit("editor:update-objects", { objects: action.next });
      setMapData((prev) => (prev ? { ...prev, objects: action.next } : null));
    } else if (action.type === "spawn") {
      EventBus.emit("editor:set-spawn", action.next);
      setSpawnCol(action.next.col);
      setSpawnRow(action.next.row);
    }
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    const handler = (data: { col: number; row: number }) => {
      setHoverCol(data.col);
      setHoverRow(data.row);
    };
    EventBus.on("editor:tile-hover", handler);
    return () => {
      EventBus.off("editor:tile-hover", handler);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Request fresh map data from Phaser
      const freshData = await new Promise<{
        layers: { floor: number[][]; walls: number[][] };
        objects: MapObject[];
        spawnCol: number;
        spawnRow: number;
      }>((resolve) => {
        const handler = (data: {
          layers: { floor: number[][]; walls: number[][] };
          objects: MapObject[];
          spawnCol: number;
          spawnRow: number;
        }) => {
          EventBus.off("editor:map-data-response", handler);
          resolve(data);
        };
        EventBus.on("editor:map-data-response", handler);
        EventBus.emit("editor:request-map-data");
      });

      const res = await fetch(`/api/map-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          icon,
          description,
          cols,
          rows,
          layers: freshData.layers,
          objects: freshData.objects,
          spawnCol: freshData.spawnCol,
          spawnRow: freshData.spawnRow,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !mapData) {
    return (
      <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
        Loading...
      </div>
    );
  }

  return (
    <div className="theme-web h-screen flex flex-col bg-bg text-text">
      <div className="h-12 bg-surface border-b border-border flex items-center px-4 gap-4">
        <button
          onClick={() => router.push("/map-editor")}
          className="text-text-muted hover:text-text"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="bg-transparent border-b border-border text-lg font-semibold focus:outline-none focus:border-primary-light px-1"
          placeholder="Map name"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary-hover rounded text-sm font-semibold disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <MapEditorPalette
          currentLayer={currentLayer}
          currentTool={currentTool}
          selectedTileId={selectedTileId}
          selectedObjectType={selectedObjectType}
          onLayerChange={setCurrentLayer}
          onToolChange={setCurrentTool}
          onTileSelect={setSelectedTileId}
          onObjectSelect={setSelectedObjectType}
        />
        <div className="flex-1">
          <MapEditorPhaser
            mapData={mapData}
            cols={cols}
            rows={rows}
            spawnCol={spawnCol}
            spawnRow={spawnRow}
            onTileChanged={handleTileChanged}
            onObjectsChanged={handleObjectsChanged}
            onSpawnChanged={handleSpawnChanged}
          />
        </div>
      </div>
      <MapEditorToolbar
        name={templateName}
        cols={cols}
        rows={rows}
        spawnCol={spawnCol}
        spawnRow={spawnRow}
        hoverCol={hoverCol}
        hoverRow={hoverRow}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
    </div>
  );
}
