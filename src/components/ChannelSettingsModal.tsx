"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

interface ChannelSettingsModalProps {
  channelId: string;
  channelName: string;
  channelDescription: string | null;
  isPublic: boolean;
  inviteCode: string | null;
  onClose: () => void;
  onUpdated: (data: { name?: string; description?: string | null; isPublic?: boolean }) => void;
}

interface Member {
  userId: string;
  nickname: string;
  role: string;
  joinedAt: string;
  isOnline: boolean;
}

export default function ChannelSettingsModal({
  channelId, channelName, channelDescription, isPublic, inviteCode,
  onClose, onUpdated,
}: ChannelSettingsModalProps) {
  const t = useT();
  const [tab, setTab] = useState<"settings" | "members" | "gateway">("settings");
  const [name, setName] = useState(channelName);
  const [description, setDescription] = useState(channelDescription || "");
  const [visibility, setVisibility] = useState(isPublic);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [kickingUserId, setKickingUserId] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState<Member | null>(null);

  // AI Gateway state
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [gatewayToken, setGatewayToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [gatewayTestResult, setGatewayTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [gatewayError, setGatewayError] = useState("");

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch {}
    setMembersLoading(false);
  }, [channelId]);

  const loadGateway = useCallback(async () => {
    setGatewayLoading(true);
    setGatewayError("");
    try {
      const res = await fetch(`/api/channels/${channelId}/gateway`);
      if (res.ok) {
        const data = await res.json();
        const gc = data?.gatewayConfig;
        if (gc) {
          setGatewayUrl(gc.url || "");
          setGatewayToken(gc.token || "");
        }
      }
    } catch {}
    setGatewayLoading(false);
  }, [channelId]);

  useEffect(() => {
    if (tab === "members") loadMembers();
    if (tab === "gateway") loadGateway();
  }, [tab, loadMembers, loadGateway]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const updates: Record<string, unknown> = {};
    if (name.trim() !== channelName) updates.name = name.trim();
    if (description.trim() !== (channelDescription || "")) updates.description = description.trim() || null;
    if (visibility !== isPublic) updates.isPublic = visibility;
    if (!visibility && password) updates.password = password;

    if (Object.keys(updates).length === 0) {
      setSaving(false);
      return;
    }

    if (updates.isPublic === false && !password && isPublic) {
      setSaveError(t("settings.passwordRequiredForPrivate"));
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        setSaveError(data.error || t("settings.failedToSave"));
      } else {
        setSaveSuccess(true);
        setPassword("");
        onUpdated(updates as { name?: string; description?: string | null; isPublic?: boolean });
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch {
      setSaveError(t("settings.failedToSave"));
    }
    setSaving(false);
  };

  const handleKick = async (member: Member) => {
    setKickingUserId(member.userId);
    try {
      const res = await fetch(`/api/channels/${channelId}/members/${member.userId}`, { method: "DELETE" });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      }
    } catch {}
    setKickingUserId(null);
    setConfirmKick(null);
  };

  const copyInviteCode = () => {
    if (inviteCode) {
      navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleTestConnection = async () => {
    setGatewayTestResult(null);
    setGatewayError("");
    try {
      const res = await fetch(`/api/channels/${channelId}/gateway/test`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setGatewayTestResult({ success: true, message: data.message || t("settings.connected") });
      } else {
        setGatewayTestResult({ success: false, message: data.error || t("settings.connectionFailed") });
      }
    } catch {
      setGatewayTestResult({ success: false, message: t("settings.connectionFailed") });
    }
  };

  const handleSaveGateway = async () => {
    setGatewaySaving(true);
    setGatewayError("");
    const gatewayConfig = {
      url: gatewayUrl.trim() || null,
      token: gatewayToken.trim() || null,
    };
    try {
      const res = await fetch(`/api/channels/${channelId}/gateway`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gatewayConfig),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setGatewayError(data.error || t("settings.failedToSave"));
      } else {
        setGatewayTestResult({ success: true, message: t("settings.saved") });
        setTimeout(() => setGatewayTestResult(null), 3000);
      }
    } catch (err) {
      setGatewayError(t("settings.failedToSave"));
    }
    setGatewaySaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg border border-gray-700 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">{t("settings.title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>

        <div className="flex border-b border-gray-700">
          <button onClick={() => setTab("settings")}
            className={`flex-1 py-2 text-sm font-semibold ${tab === "settings" ? "text-indigo-400 border-b-2 border-indigo-400" : "text-gray-400"}`}>
            {t("settings.general")}
          </button>
          <button onClick={() => setTab("members")}
            className={`flex-1 py-2 text-sm font-semibold ${tab === "members" ? "text-indigo-400 border-b-2 border-indigo-400" : "text-gray-400"}`}>
            {t("settings.members")}
          </button>
          <button onClick={() => setTab("gateway")}
            className={`flex-1 py-2 text-sm font-semibold ${tab === "gateway" ? "text-indigo-400 border-b-2 border-indigo-400" : "text-gray-400"}`}>
            {t("settings.gateway")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "settings" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1">{t("settings.channelName")}</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1">{t("settings.description")}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white focus:outline-none focus:border-indigo-500 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1">{t("settings.visibility")}</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setVisibility(true)}
                    className={`px-3 py-1 rounded text-sm ${visibility ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400"}`}>{t("channels.public")}</button>
                  <button type="button" onClick={() => setVisibility(false)}
                    className={`px-3 py-1 rounded text-sm ${!visibility ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400"}`}>{t("channels.private")}</button>
                </div>
                {!visibility && isPublic && <p className="text-amber-400 text-xs mt-1">{t("settings.switchToPrivateWarning")}</p>}
                {visibility && !isPublic && <p className="text-amber-400 text-xs mt-1">{t("settings.switchToPublicWarning")}</p>}
              </div>
              {!visibility && (
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1">{isPublic ? t("settings.setPassword") : t("settings.changePassword")}</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100}
                    placeholder={isPublic ? t("settings.passwordPlaceholderNew") : t("settings.passwordPlaceholderKeep")}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1">{t("settings.inviteCode")}</label>
                <div className="flex gap-2">
                  <code className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-amber-400 font-mono text-sm">{inviteCode || "—"}</code>
                  <button onClick={copyInviteCode} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white">{copied ? t("game.copied") : t("common.copy")}</button>
                </div>
              </div>
              {saveError && <p className="text-red-400 text-sm">{saveError}</p>}
              {saveSuccess && <p className="text-green-400 text-sm">{t("settings.saved")}</p>}
              <button onClick={handleSave} disabled={saving}
                className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded font-semibold text-white disabled:opacity-50">
                {saving ? t("common.loading") : t("common.save")}
              </button>
            </div>
          ) : tab === "members" ? (
            <div>
              {membersLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">{t("settings.loadingMembers")}</p>
              ) : members.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">{t("settings.noMembers")}</p>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between px-3 py-2 bg-gray-900 rounded">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${m.isOnline ? "bg-green-400" : "bg-gray-600"}`} />
                        <span className="text-white text-sm">{m.nickname}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${m.role === "owner" ? "bg-amber-600/30 text-amber-400" : "bg-gray-700 text-gray-400"}`}>
                          {m.role === "owner" ? t("settings.roleOwner") : t("settings.roleMember")}
                        </span>
                      </div>
                      {m.role !== "owner" && (
                        <button onClick={() => setConfirmKick(m)} disabled={kickingUserId === m.userId}
                          className="text-red-400 hover:text-red-300 text-xs px-2 py-1 disabled:opacity-50">{t("settings.kick")}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {confirmKick && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded">
                  <p className="text-sm text-white mb-2">{t("settings.kickConfirm", { name: confirmKick.nickname })}</p>
                  <div className="flex gap-2">
                    <button onClick={() => handleKick(confirmKick)} className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm text-white">{t("common.confirm")}</button>
                    <button onClick={() => setConfirmKick(null)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300">{t("common.cancel")}</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {gatewayLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">{t("settings.loadingGateway")}</p>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1">{t("settings.gatewayUrl")}</label>
                    <input
                      type="text"
                      value={gatewayUrl}
                      onChange={(e) => setGatewayUrl(e.target.value)}
                      placeholder={t("settings.gatewayUrlPlaceholder")}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1">{t("settings.gatewayToken")}</label>
                    <div className="flex gap-2">
                      <input
                        type={showToken ? "text" : "password"}
                        value={gatewayToken}
                        onChange={(e) => setGatewayToken(e.target.value)}
                        placeholder={t("settings.gatewayTokenPlaceholder")}
                        className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken((v) => !v)}
                        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
                      >
                        {showToken ? t("common.hide") : t("common.show")}
                      </button>
                    </div>
                  </div>
                  {gatewayTestResult && (
                    <p className={`text-sm ${gatewayTestResult.success ? "text-green-400" : "text-red-400"}`}>
                      {gatewayTestResult.message}
                    </p>
                  )}
                  {gatewayError && <p className="text-red-400 text-sm">{gatewayError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-semibold text-white"
                    >
                      {t("settings.testConnection")}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveGateway}
                      disabled={gatewaySaving}
                      className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded font-semibold text-white disabled:opacity-50"
                    >
                      {gatewaySaving ? t("common.loading") : t("common.save")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
