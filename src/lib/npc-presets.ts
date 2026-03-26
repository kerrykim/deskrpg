import { OFFICE_PRESETS } from "./office-presets";

export interface NpcPreset {
  id: string;
  name: string;
  appearance: {
    bodyType: string;
    layers: Record<string, { itemKey: string; variant: string }>;
  };
}

/** Convert office presets to NPC appearance presets */
export const NPC_PRESETS: NpcPreset[] = OFFICE_PRESETS.map((p) => ({
  id: p.id,
  name: p.nameKo,
  appearance: {
    bodyType: p.bodyType,
    layers: Object.fromEntries(
      Object.entries(p.layers)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, { itemKey: v!.itemKey, variant: v!.variant }]),
    ),
  },
}));
