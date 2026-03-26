"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { BookOpen, X, Pin, CheckCircle, MessageSquare, FileDown, FileText, ClipboardCopy, ChevronDown, ChevronUp } from "lucide-react";

interface MeetingMinutesItem {
  id: string;
  topic: string;
  totalTurns: number;
  durationSeconds: number | null;
  participants: { id: string; name: string; type: string }[];
  keyTopics: string[];
  createdAt: string;
}

interface MeetingMinutesDetail extends MeetingMinutesItem {
  transcript: string;
  conclusions: string | null;
}

interface MinutesModalProps {
  channelId: string;
  onClose: () => void;
}

export default function MinutesModal({ channelId, onClose }: MinutesModalProps) {
  const t = useT();
  const [items, setItems] = useState<MeetingMinutesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingMinutesDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);

  useEffect(() => {
    fetch(`/api/meetings?channelId=${channelId}`)
      .then((r) => r.json())
      .then((data) => { setItems(data.minutes || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [channelId]);

  const loadDetail = useCallback((id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setShowTranscript(false);
    fetch(`/api/meetings/${id}`)
      .then((r) => r.json())
      .then((data) => { setDetail(data.minutes || null); setDetailLoading(false); })
      .catch(() => setDetailLoading(false));
  }, []);

  const handleExport = useCallback(async (format: string) => {
    if (!selectedId) return;
    setExportMenu(false);
    if (format === "clipboard") {
      const res = await fetch(`/api/meetings/${selectedId}/export?format=clipboard`);
      const data = await res.json();
      await navigator.clipboard.writeText(data.text);
      return;
    }
    // Download MD
    const a = document.createElement("a");
    a.href = `/api/meetings/${selectedId}/export?format=${format}`;
    a.download = "";
    a.click();
  }, [selectedId]);

  const formatDuration = (s: number | null) => {
    if (!s) return "N/A";
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}분` : `${s}초`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-[90vw] max-w-[800px] h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><BookOpen className="w-4 h-4" />{t("minutes.title")}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Body: 2-pane */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: list */}
          <div className="w-[220px] border-r border-border overflow-y-auto p-3 flex-shrink-0">
            {loading ? (
              <div className="text-xs text-text-dim text-center mt-8">{t("common.loading")}</div>
            ) : items.length === 0 ? (
              <div className="text-xs text-text-dim text-center mt-8">{t("minutes.noMinutes")}</div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => loadDetail(item.id)}
                  className={`p-2.5 rounded-lg mb-2 cursor-pointer text-xs ${
                    selectedId === item.id
                      ? "bg-info/15 border-l-2 border-info"
                      : "bg-surface hover:bg-surface-raised border-l-2 border-transparent"
                  }`}
                >
                  <div className="font-bold truncate">{item.topic}</div>
                  <div className="text-text-dim mt-1">
                    {new Date(item.createdAt).toLocaleDateString("ko-KR")} · {item.participants.length}명 · {item.totalTurns}턴
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right: detail */}
          <div className="flex-1 overflow-y-auto p-4">
            {!selectedId ? (
              <div className="flex items-center justify-center h-full text-xs text-text-dim">
                {t("minutes.selectMinutes")}
              </div>
            ) : detailLoading ? (
              <div className="flex items-center justify-center h-full text-xs text-text-dim">{t("common.loading")}</div>
            ) : detail ? (
              <div className="text-xs">
                <div className="font-bold text-base mb-1">{detail.topic}</div>
                <div className="text-text-dim mb-3">
                  {new Date(detail.createdAt).toLocaleString("ko-KR")} · {formatDuration(detail.durationSeconds)}
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-surface rounded-lg p-2 text-center">
                    <div className="text-[10px] text-text-dim">참가자</div>
                    <div className="text-lg font-bold text-info">{detail.participants.length}명</div>
                  </div>
                  <div className="bg-surface rounded-lg p-2 text-center">
                    <div className="text-[10px] text-text-dim">총 턴</div>
                    <div className="text-lg font-bold text-info">{detail.totalTurns}턴</div>
                  </div>
                </div>

                {detail.keyTopics.length > 0 && (
                  <div className="mb-3">
                    <div className="font-bold text-info mb-1 flex items-center gap-1"><Pin className="w-3.5 h-3.5" />{t("meeting.keyTopics")}</div>
                    <ul className="list-disc list-inside text-text-secondary space-y-0.5">
                      {detail.keyTopics.map((topic, i) => <li key={i}>{topic}</li>)}
                    </ul>
                  </div>
                )}

                {detail.conclusions && (
                  <div className="mb-3">
                    <div className="font-bold text-success mb-1 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />{t("meeting.conclusions")}</div>
                    <div className="text-text-secondary leading-relaxed">{detail.conclusions}</div>
                  </div>
                )}

                <div className="mb-3">
                  <button
                    onClick={() => setShowTranscript(!showTranscript)}
                    className="font-bold text-text-muted hover:text-text mb-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5 inline mr-1" />{t("minutes.fullTranscript")} {showTranscript ? <ChevronUp className="w-3.5 h-3.5 inline ml-1" /> : <ChevronDown className="w-3.5 h-3.5 inline ml-1" />}
                  </button>
                  {showTranscript && (
                    <pre className="bg-surface rounded-lg p-3 text-text-secondary whitespace-pre-wrap text-[11px] max-h-[300px] overflow-y-auto">
                      {detail.transcript}
                    </pre>
                  )}
                </div>

                <div className="relative">
                  <button
                    onClick={() => setExportMenu(!exportMenu)}
                    className="px-3 py-1.5 bg-surface-raised hover:brightness-125 rounded-lg text-text-secondary"
                  >
                    <FileDown className="w-3.5 h-3.5 inline mr-1" />{t("meeting.export")} <ChevronDown className="w-3 h-3 inline ml-0.5" />
                  </button>
                  {exportMenu && (
                    <div className="absolute bottom-full mb-1 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
                      <button onClick={() => handleExport("md")} className="w-full text-left px-3 py-1.5 hover:bg-surface-raised flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />{t("meeting.exportMd")}</button>
                      <button onClick={() => handleExport("clipboard")} className="w-full text-left px-3 py-1.5 hover:bg-surface-raised flex items-center gap-1.5"><ClipboardCopy className="w-3.5 h-3.5" />{t("meeting.exportClipboard")}</button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
