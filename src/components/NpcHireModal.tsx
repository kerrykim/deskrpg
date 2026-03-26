"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { CharacterAppearance } from "@/lib/lpc-registry";
import type { NpcPreset } from "@/lib/npc-presets";
import { PERSONA_PRESETS, applyPresetName } from "@/lib/npc-persona-presets";
import { useT } from "@/lib/i18n";
import { Trash2 } from "lucide-react";
import { useCharacterAppearance } from "@/hooks/useCharacterAppearance";
import CharacterPreview from "@/components/CharacterPreview";
import AppearanceEditor from "@/components/AppearanceEditor";
import {
  FRAME_WIDTH,
  FRAME_HEIGHT,
} from "@/lib/sprite-compositor";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREVIEW_SCALE = 3;
const DIRECTION_LABELS: { id: string; label: string }[] = [
  { id: "down", label: "↓" },
  { id: "left", label: "←" },
  { id: "right", label: "→" },
  { id: "up", label: "↑" },
];
const MAX_NPC_COUNT = 10;

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

interface GatewayAgent {
  id: string;
  name: string;
  workspace: string;
  inUse: boolean;
  usedByNpcName: string | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NpcHireModalProps {
  channelId: string;
  isOpen: boolean;
  onClose: () => void;
  onPlaceOnMap: (npcData: {
    name: string;
    persona: string;
    appearance: unknown;
    direction: string;
    agentId?: string;
    agentAction?: "select" | "create";
    identity?: string;
    soul?: string;
  }) => void;
  onSaveEdit?: (
    npcId: string,
    updates: { name?: string; persona?: string; appearance?: unknown; identity?: string; soul?: string; agentId?: string; agentAction?: "select" | "create" },
  ) => void;
  editingNpc?: {
    id: string;
    name: string;
    persona: string;
    appearance: unknown;
    agentId?: string | null;
  } | null;
  currentNpcCount: number;
  hasGateway: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NpcHireModal({
  channelId,
  isOpen,
  onClose,
  onPlaceOnMap,
  onSaveEdit,
  editingNpc,
  currentNpcCount,
  hasGateway,
}: NpcHireModalProps) {
  const t = useT();

  // --- Appearance (shared hook) ---
  const {
    bodyType, setBodyType, layers, setLayers,
    activeCategory, setActiveCategory,
    handleBodyTypeChange, selectItem, clearCategory, setVariant, setSkin,
    isItemCompatible, getItemBodyTypes, compatibleCount,
    randomize, buildAppearance: buildAppearanceFromHook,
  } = useCharacterAppearance();

  // --- NPC-specific state ---
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [soul, setSoul] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [appearanceMode, setAppearanceMode] = useState<"presets" | "custom">("presets");

  // Step flow state
  const [step, setStep] = useState<"configure" | "creating-agent" | "place">("configure");
  const [agentProgress, setAgentProgress] = useState<{ status: string; error?: string }>({ status: "" });

  // Agent selection state
  const [agentMode, setAgentMode] = useState<"connect" | "none">("connect");
  const [gatewayAgents, setGatewayAgents] = useState<GatewayAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [createNewAgent, setCreateNewAgent] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [newAgentIdError, setNewAgentIdError] = useState<string | null>(null);

  // Persona preset state
  const [personaPresetId, setPersonaPresetId] = useState<string>("custom");

  // Direction
  const [direction, setDirection] = useState("down");

  // Presets
  const [presets, setPresets] = useState<NpcPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetsLoading, setPresetsLoading] = useState(false);

  // --- Derived ---
  const isEdit = !!editingNpc;
  const atLimit = currentNpcCount >= MAX_NPC_COUNT;
  const isExistingAgentSelected = hasGateway && agentMode === "connect" && selectedAgentId && !createNewAgent;
  const personaCompat = identity.trim();
  const canSubmit = name.trim().length > 0 && (personaCompat.length > 0 || isExistingAgentSelected);

  // --- Build appearance (with preset support) ---
  const buildAppearance = useCallback((): CharacterAppearance => {
    if (appearanceMode === "presets" && selectedPresetId) {
      const preset = presets.find((p) => p.id === selectedPresetId);
      if (preset) return preset.appearance as CharacterAppearance;
    }
    return buildAppearanceFromHook();
  }, [appearanceMode, selectedPresetId, presets, buildAppearanceFromHook]);

  // --- Validate new agent ID ---
  const validateNewAgentId = (value: string) => {
    if (!value) { setNewAgentIdError(null); return; }
    if (!/^[a-zA-Z0-9-]+$/.test(value)) setNewAgentIdError("Only alphanumeric characters and hyphens allowed");
    else if (value.length < 3) setNewAgentIdError("At least 3 characters");
    else if (value.length > 30) setNewAgentIdError("Maximum 30 characters");
    else if (gatewayAgents.some((a) => a.id === value)) setNewAgentIdError("Agent ID already exists on gateway");
    else setNewAgentIdError(null);
  };

  // --- Initialise / reset on open or editingNpc change ---
  useEffect(() => {
    if (!isOpen) return;
    setStep("configure");
    setAgentProgress({ status: "" });

    if (editingNpc) {
      setName(editingNpc.name);
      setIdentity(editingNpc.persona || "");
      setSoul("");
      setShowAdvanced(false);
      const app = editingNpc.appearance as CharacterAppearance | null;
      if (app && app.bodyType && app.layers) {
        setBodyType(app.bodyType);
        setLayers(app.layers);
        setAppearanceMode("custom");
        setSelectedPresetId(null);
      }
      setPersonaPresetId("custom");
      if (editingNpc.agentId) {
        setAgentMode("connect");
        setSelectedAgentId(editingNpc.agentId);
        setCreateNewAgent(false);
      } else {
        setAgentMode(hasGateway ? "connect" : "none");
        setSelectedAgentId(null);
        setCreateNewAgent(false);
      }
    } else {
      setName("");
      setIdentity("");
      setSoul("");
      setShowAdvanced(false);
      setBodyType("male");
      setLayers({ body: { itemKey: "body", variant: "light" }, eye_color: { itemKey: "eye_color", variant: "brown" } });
      setActiveCategory("body");
      setDirection("down");
      setAppearanceMode("presets");
      setSelectedPresetId(null);
      setPersonaPresetId("custom");
      setAgentMode(hasGateway ? "connect" : "none");
      setSelectedAgentId(null);
      setCreateNewAgent(false);
      setNewAgentId("");
      setNewAgentIdError(null);
    }
  }, [isOpen, editingNpc, hasGateway, setBodyType, setLayers, setActiveCategory]);

  // --- Fetch gateway agents ---
  useEffect(() => {
    if (!isOpen || !hasGateway) return;
    setAgentsLoading(true);
    fetch(`/api/channels/${channelId}/gateway/agents`)
      .then((r) => r.json())
      .then((data) => setGatewayAgents(data.agents ?? []))
      .catch(() => setGatewayAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [isOpen, hasGateway, channelId]);

  // --- Fetch presets ---
  useEffect(() => {
    if (!isOpen) return;
    setPresetsLoading(true);
    fetch("/api/npcs/presets")
      .then((r) => r.json())
      .then((data) => setPresets(data.presets ?? []))
      .catch(() => {})
      .finally(() => setPresetsLoading(false));
  }, [isOpen]);

  // --- Apply persona preset ---
  const handlePersonaPresetChange = (presetId: string) => {
    setPersonaPresetId(presetId);
    if (presetId === "custom") { setIdentity(""); setSoul(""); return; }
    const preset = PERSONA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const currentName = name.trim() || "NPC";
    setIdentity(applyPresetName(preset.identity, currentName));
    setSoul(applyPresetName(preset.soul, currentName));
  };

  const handleNameChange = (newName: string) => {
    setName(newName);
    if (personaPresetId !== "custom") {
      const preset = PERSONA_PRESETS.find((p) => p.id === personaPresetId);
      if (preset) {
        const n = newName.trim() || "NPC";
        setIdentity(applyPresetName(preset.identity, n));
        setSoul(applyPresetName(preset.soul, n));
      }
    }
  };

  // --- Create agent on gateway ---
  const handleCreateAgent = async () => {
    if (!hasGateway || agentMode !== "connect" || !createNewAgent || !newAgentId.trim()) {
      handleSubmit();
      return;
    }
    setStep("creating-agent");
    setAgentProgress({ status: "1/3 -- SSH connecting..." });
    try {
      const res = await fetch("/api/npcs/create-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, agentId: newAgentId.trim(), identity: identity.trim(), soul: soul.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setAgentProgress({ status: "Failed", error: data.error || "Agent creation failed" });
        return;
      }
      setAgentProgress({ status: "3/3 -- Done!" });
      setTimeout(() => setStep("place"), 500);
    } catch {
      setAgentProgress({ status: "Failed", error: "Network error" });
    }
  };

  // --- Submit ---
  const handleSubmit = () => {
    if (!canSubmit) return;
    const appearance = buildAppearance();

    if (isEdit && onSaveEdit) {
      let agentId: string | undefined;
      let agentAction: "select" | "create" | undefined;
      if (hasGateway && agentMode === "connect") {
        if (createNewAgent && newAgentId.trim()) { agentId = newAgentId.trim(); agentAction = "create"; }
        else if (selectedAgentId) { agentId = selectedAgentId; agentAction = selectedAgentId !== editingNpc!.agentId ? "select" : undefined; }
      }
      onSaveEdit(editingNpc!.id, { name: name.trim(), persona: personaCompat, appearance, identity: identity.trim(), soul: soul.trim(), agentId, agentAction });
    } else {
      let agentId: string | undefined;
      let agentAction: "select" | "create" | undefined;
      if (hasGateway && agentMode === "connect") {
        if (createNewAgent && newAgentId.trim()) { agentId = newAgentId.trim(); agentAction = "create"; }
        else if (selectedAgentId) { agentId = selectedAgentId; agentAction = "select"; }
      }
      onPlaceOnMap({ name: name.trim(), persona: personaCompat, appearance, direction, agentId, agentAction, identity: identity.trim(), soul: soul.trim() });
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleBackdropClick}>
      <div className="relative max-w-4xl w-full mx-4 max-h-[90vh] bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">
            {isEdit ? t("npc.edit") : t("npc.hire")}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left section — inputs + appearance selector */}
          <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">{t("npc.name")}</label>
              <input
                type="text" maxLength={50} value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t("npc.namePlaceholder")}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* AI Agent Section */}
            {hasGateway && !isEdit && (
              <AgentSection
                agentMode={agentMode} setAgentMode={setAgentMode}
                gatewayAgents={gatewayAgents} setGatewayAgents={setGatewayAgents}
                agentsLoading={agentsLoading}
                selectedAgentId={selectedAgentId} setSelectedAgentId={setSelectedAgentId}
                createNewAgent={createNewAgent} setCreateNewAgent={setCreateNewAgent}
                newAgentId={newAgentId} setNewAgentId={setNewAgentId}
                newAgentIdError={newAgentIdError}
                validateNewAgentId={validateNewAgentId}
                channelId={channelId}
                t={t}
              />
            )}

            {/* Persona Section */}
            <PersonaSection
              isExistingAgentSelected={!!isExistingAgentSelected}
              personaPresetId={personaPresetId}
              onPersonaPresetChange={handlePersonaPresetChange}
              identity={identity} setIdentity={setIdentity}
              soul={soul} setSoul={setSoul}
              showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
              t={t}
            />

            {/* Appearance */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t("npc.appearance")}</label>
              <div className="flex gap-1 mb-3">
                <button
                  onClick={() => setAppearanceMode("presets")}
                  className={`px-4 py-1.5 rounded text-sm font-medium ${
                    appearanceMode === "presets" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >{t("npc.presets")}</button>
                <button
                  onClick={() => setAppearanceMode("custom")}
                  className={`px-4 py-1.5 rounded text-sm font-medium ${
                    appearanceMode === "custom" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >{t("npc.personaCustom")}</button>
              </div>

              {appearanceMode === "presets" && (
                <div>
                  {presetsLoading ? (
                    <p className="text-sm text-gray-500">{t("npc.loadingPresets")}</p>
                  ) : presets.length === 0 ? (
                    <p className="text-sm text-gray-500">{t("npc.noPresets")}</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {presets.map((preset) => (
                        <PresetCard
                          key={preset.id}
                          preset={preset}
                          isSelected={selectedPresetId === preset.id}
                          onSelect={() => setSelectedPresetId(preset.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {appearanceMode === "custom" && (
                <AppearanceEditor
                  bodyType={bodyType}
                  layers={layers}
                  activeCategory={activeCategory}
                  onBodyTypeChange={(bt) => handleBodyTypeChange(bt)}
                  onSkinChange={setSkin}
                  onSelectItem={selectItem}
                  onClearCategory={clearCategory}
                  onSetVariant={setVariant}
                  onSetActiveCategory={setActiveCategory}
                  isItemCompatible={isItemCompatible}
                  getItemBodyTypes={getItemBodyTypes}
                  compatibleCount={compatibleCount}
                  variant="compact"
                  presetsSlot={
                    <button
                      onClick={randomize}
                      className="w-full px-2 py-1 bg-indigo-900/60 hover:bg-indigo-800 rounded text-xs text-indigo-300 text-center font-semibold mb-1"
                    >{t("characters.random")}</button>
                  }
                />
              )}
            </div>
          </div>

          {/* Right section — preview canvas */}
          <div className="w-56 flex flex-col items-center justify-center gap-4 p-6 border-l border-gray-700">
            <CharacterPreview
              appearance={buildAppearance()}
              scale={PREVIEW_SCALE}
              direction={direction}
              active={isOpen}
            />
            <p className="text-xs text-gray-500 mb-2">Preview</p>
            <div className="flex gap-1">
              {DIRECTION_LABELS.map((d) => (
                <button
                  key={d.id} type="button"
                  onClick={() => setDirection(d.id)}
                  className={`w-8 h-8 rounded text-sm font-bold ${
                    direction === d.id ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                >{d.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
          <div>
            {!isEdit && atLimit && (
              <p className="text-xs text-amber-400">
                NPC limit reached ({MAX_NPC_COUNT}/{MAX_NPC_COUNT}). Remove an existing NPC to hire a new one.
              </p>
            )}
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={onClose} className="px-4 py-2 rounded text-sm bg-gray-700 text-gray-300 hover:bg-gray-600">
              {t("common.cancel")}
            </button>

            {step === "configure" && (
              <button
                onClick={() => {
                  if (isEdit) handleSubmit();
                  else if (hasGateway && agentMode === "connect" && createNewAgent && newAgentId.trim()) handleCreateAgent();
                  else handleSubmit();
                }}
                disabled={!canSubmit || (!isEdit && atLimit)}
                className="px-5 py-2 rounded text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isEdit ? t("common.save") : (hasGateway && agentMode === "connect" && createNewAgent && newAgentId.trim()) ? t("common.next") : t("npc.placeOnMap")}
              </button>
            )}

            {step === "creating-agent" && (
              <div className="flex-1 flex flex-col gap-2 min-w-[200px]">
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      agentProgress.error ? "bg-red-500" : agentProgress.status.includes("Done") ? "bg-green-500" : "bg-indigo-500 animate-pulse"
                    }`}
                    style={{ width: agentProgress.error ? "100%" : agentProgress.status.includes("1/3") ? "33%" : agentProgress.status.includes("2/3") ? "66%" : agentProgress.status.includes("Done") ? "100%" : "10%" }}
                  />
                </div>
                <p className={`text-xs ${agentProgress.error ? "text-red-400" : "text-gray-400"}`}>
                  {agentProgress.error || agentProgress.status}
                </p>
                {agentProgress.error && (
                  <button
                    onClick={() => { setStep("configure"); setAgentProgress({ status: "" }); }}
                    className="px-3 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 self-start"
                  >{t("common.back")}</button>
                )}
              </div>
            )}

            {step === "place" && (
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || (!isEdit && atLimit)}
                className="px-5 py-2 rounded text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >{t("npc.placeOnMap")}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Section sub-component
// ---------------------------------------------------------------------------

function AgentSection({
  agentMode, setAgentMode,
  gatewayAgents, setGatewayAgents,
  agentsLoading,
  selectedAgentId, setSelectedAgentId,
  createNewAgent, setCreateNewAgent,
  newAgentId, setNewAgentId,
  newAgentIdError,
  validateNewAgentId,
  channelId,
  t,
}: {
  agentMode: "connect" | "none";
  setAgentMode: (m: "connect" | "none") => void;
  gatewayAgents: GatewayAgent[];
  setGatewayAgents: React.Dispatch<React.SetStateAction<GatewayAgent[]>>;
  agentsLoading: boolean;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  createNewAgent: boolean;
  setCreateNewAgent: (v: boolean) => void;
  newAgentId: string;
  setNewAgentId: (v: string) => void;
  newAgentIdError: string | null;
  validateNewAgentId: (v: string) => void;
  channelId: string;
  t: (key: string) => string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">AI Agent</label>
      <div className="flex gap-2 mb-3">
        <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm cursor-pointer ${
          agentMode === "connect" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
        }`}>
          <input type="radio" name="agentMode" value="connect" checked={agentMode === "connect"}
            onChange={() => { setAgentMode("connect"); setCreateNewAgent(false); setSelectedAgentId(null); }}
            className="sr-only" />
          Connect to Gateway Agent
        </label>
        <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm cursor-pointer ${
          agentMode === "none" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
        }`}>
          <input type="radio" name="agentMode" value="none" checked={agentMode === "none"}
            onChange={() => { setAgentMode("none"); setSelectedAgentId(null); setCreateNewAgent(false); }}
            className="sr-only" />
          No AI (static NPC)
        </label>
      </div>

      {agentMode === "connect" && (
        <div className="space-y-2">
          {agentsLoading ? (
            <p className="text-sm text-gray-500">Loading agents...</p>
          ) : (
            <>
              <div className="flex gap-2">
                <select
                  value={createNewAgent ? "__create__" : (selectedAgentId || "")}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__create__") { setCreateNewAgent(true); setSelectedAgentId(null); }
                    else { setCreateNewAgent(false); setSelectedAgentId(val || null); setNewAgentId(""); }
                  }}
                  className="flex-1 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Select agent --</option>
                  {gatewayAgents.map((agent) => (
                    <option key={agent.id} value={agent.id} disabled={agent.inUse}>
                      {agent.name || agent.id}{agent.inUse ? ` (in use: ${agent.usedByNpcName})` : " (available)"}
                    </option>
                  ))}
                  <option value="__create__">+ Create New Agent</option>
                </select>
                {selectedAgentId && !createNewAgent && (() => {
                  const agent = gatewayAgents.find(a => a.id === selectedAgentId);
                  return agent && !agent.inUse ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`${t("npc.deleteAgent")}: ${agent.name || agent.id}?`)) return;
                        try {
                          const res = await fetch(`/api/channels/${channelId}/gateway/agents?agentId=${agent.id}`, { method: "DELETE" });
                          if (res.ok) { setGatewayAgents(prev => prev.filter(a => a.id !== agent.id)); setSelectedAgentId(null); }
                          else { const data = await res.json(); alert(data.error || t("npc.deleteFailed")); }
                        } catch { alert(t("npc.deleteFailed")); }
                      }}
                      className="px-2 py-2 rounded bg-red-800 hover:bg-red-700 text-white text-sm shrink-0"
                      title={t("npc.deleteAgent")}
                    ><Trash2 className="w-4 h-4" /></button>
                  ) : null;
                })()}
              </div>

              {createNewAgent && (
                <div>
                  <input
                    type="text" maxLength={30} value={newAgentId}
                    onChange={(e) => { setNewAgentId(e.target.value); validateNewAgentId(e.target.value); }}
                    placeholder={t("npc.agentIdPlaceholder")}
                    className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {newAgentIdError && <p className="text-xs text-red-400 mt-1">{newAgentIdError}</p>}
                  <p className="text-xs text-gray-500 mt-1">{t("npc.agentIdHint")}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persona Section sub-component
// ---------------------------------------------------------------------------

function PersonaSection({
  isExistingAgentSelected,
  personaPresetId, onPersonaPresetChange,
  identity, setIdentity,
  soul, setSoul,
  showAdvanced, setShowAdvanced,
  t,
}: {
  isExistingAgentSelected: boolean;
  personaPresetId: string;
  onPersonaPresetChange: (id: string) => void;
  identity: string;
  setIdentity: (v: string) => void;
  soul: string;
  setSoul: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{t("npc.persona")}</label>

      {!isExistingAgentSelected && (
        <div className="mb-2">
          <select
            value={personaPresetId}
            onChange={(e) => onPersonaPresetChange(e.target.value)}
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="custom">{t("npc.personaCustom")}</option>
            {PERSONA_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.role}</option>
            ))}
          </select>
        </div>
      )}

      {isExistingAgentSelected ? (
        <div className="bg-gray-800 border border-gray-700 rounded p-3">
          <p className="text-xs text-gray-400 italic mb-1">{t("npc.personaManagedOnGateway")}</p>
          <p className="text-sm text-gray-500">{t("npc.personaManagedHint")}</p>
        </div>
      ) : (
        <>
          <textarea
            maxLength={2000} rows={4} value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder={t("npc.identityPlaceholder")}
            className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-500 mt-1 text-right">{identity.length}/2000</p>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 flex items-center gap-1"
          >
            <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>&#9654;</span>
            {t("npc.advanced")}
          </button>

          {showAdvanced && (
            <div className="mt-2">
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {t("npc.soul")} {t("npc.advancedHint")}
              </label>
              <textarea
                maxLength={3000} rows={6} value={soul}
                onChange={(e) => setSoul(e.target.value)}
                placeholder={t("npc.soulPlaceholder")}
                className="w-full px-3 py-2 rounded bg-gray-800 border border-gray-700 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1 text-right">{soul.length}/3000</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset Card sub-component
// ---------------------------------------------------------------------------

function PresetCard({
  preset, isSelected, onSelect,
}: {
  preset: NpcPreset;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition-colors ${
        isSelected ? "border-indigo-500 bg-gray-800" : "border-transparent bg-gray-800 hover:border-gray-600"
      }`}
    >
      <CharacterPreview
        appearance={preset.appearance as CharacterAppearance}
        scale={2}
        fps={6}
      />
      <span className="text-xs text-gray-300">{preset.name}</span>
    </button>
  );
}
