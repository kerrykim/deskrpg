"use client";

import { useT } from "@/lib/i18n";
import { Clock, Circle, Check, X as XIcon, Bot } from "lucide-react";
import Badge from "./ui/Badge";

interface Task {
  id: string;
  npcId?: string;
  npcTaskId?: string;
  title: string;
  summary: string | null;
  status: string;
  npcName?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

interface TaskCardProps {
  task: Task;
  showNpcName?: boolean;
  compact?: boolean;
  onDelete?: (taskId: string) => void;
}

const STATUS_CONFIG: Record<string, { color: string; border: string; icon: React.ReactNode; labelKey: string }> = {
  pending: { labelKey: "task.pending", color: "text-npc", border: "border-l-npc", icon: <Clock className="w-3 h-3 inline" /> },
  in_progress: { labelKey: "task.inProgress", color: "text-danger", border: "border-l-danger", icon: <Circle className="w-3 h-3 inline" /> },
  complete: { labelKey: "task.complete", color: "text-success", border: "border-l-success", icon: <Check className="w-3 h-3 inline" /> },
  cancelled: { labelKey: "task.cancelled", color: "text-text-muted", border: "border-l-text-muted", icon: <XIcon className="w-3 h-3 inline" /> },
};

export default function TaskCard({ task, showNpcName = false, compact = false, onDelete }: TaskCardProps) {
  const t = useT();
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
  const npcName = task.npcName || "";
  const npcTaskId = task.npcTaskId || "";
  const updatedAt = task.updatedAt || task.createdAt || "";
  const isFinished = task.status === "complete" || task.status === "cancelled";

  function timeAgo(dateStr: string): string {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("task.justNow");
    if (mins < 60) return t("task.minutesAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("task.hoursAgo", { count: hours });
    return t("task.daysAgo", { count: Math.floor(hours / 24) });
  }

  return (
    <div
      className={`bg-surface rounded-lg p-2.5 border-l-[3px] ${config.border} ${
        isFinished ? "opacity-60" : ""
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <span className={`text-[10px] font-bold ${config.color}`}>
          {config.icon} {t(config.labelKey)}
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-text-dim">{npcTaskId}</span>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
              className="text-text-dim hover:text-danger text-[10px] ml-1"
              title={t("common.delete")}
            >
              x
            </button>
          )}
        </div>
      </div>
      <div className="text-text text-caption font-bold mb-1">{task.title}</div>
      {!compact && task.summary && (
        <div className="text-text-muted text-[10px] mb-1.5 line-clamp-2">{task.summary}</div>
      )}
      <div className="flex justify-between items-center text-[9px] text-text-dim">
        {showNpcName && npcName && (
          <Badge variant="npc" size="sm">
            <Bot className="w-3 h-3" />{npcName}
          </Badge>
        )}
        <span>{timeAgo(updatedAt)}</span>
      </div>
    </div>
  );
}

export type { Task };
