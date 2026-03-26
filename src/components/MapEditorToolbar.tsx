"use client";

interface MapEditorToolbarProps {
  name: string;
  cols: number;
  rows: number;
  spawnCol: number;
  spawnRow: number;
  hoverCol: number;
  hoverRow: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function MapEditorToolbar({
  name, cols, rows, spawnCol, spawnRow, hoverCol, hoverRow, canUndo, canRedo, onUndo, onRedo,
}: MapEditorToolbarProps) {
  return (
    <div className="h-10 bg-surface border-t border-border flex items-center px-4 gap-6 text-xs text-text-muted">
      <span className="font-semibold text-text">{name}</span>
      <span>Size: {cols} x {rows}</span>
      <span>Spawn: ({spawnCol}, {spawnRow})</span>
      {hoverCol >= 0 && <span>Cursor: ({hoverCol}, {hoverRow})</span>}
      <div className="ml-auto flex gap-2">
        <button onClick={onUndo} disabled={!canUndo}
          className="px-2 py-1 rounded bg-surface-raised border border-border disabled:opacity-30 hover:bg-surface"
          title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={onRedo} disabled={!canRedo}
          className="px-2 py-1 rounded bg-surface-raised border border-border disabled:opacity-30 hover:bg-surface"
          title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
    </div>
  );
}
