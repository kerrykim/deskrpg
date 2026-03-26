"use client";

import { useEffect, useState } from "react";
import TaskCard from "./TaskCard";
import type { Task } from "./TaskCard";
import type { Socket } from "socket.io-client";
import { useT } from "@/lib/i18n";

interface TaskPanelProps {
  npcId: string;
  npcName: string;
  socket: Socket | null;
}

export default function TaskPanel({ npcId, npcName, socket }: TaskPanelProps) {
  const t = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!socket || !npcId) return;

    socket.emit("task:list", { channelId: null, npcId });

    const handleTaskList = ({ tasks: taskList, npcId: responseNpcId }: { tasks: Task[]; npcId: string | null }) => {
      if (responseNpcId !== npcId) return;
      setTasks(taskList);
      setLoading(false);
    };

    socket.on("task:list-response", handleTaskList);
    return () => { socket.off("task:list-response", handleTaskList); };
  }, [socket, npcId]);

  useEffect(() => {
    if (!socket) return;

    const handleTaskUpdated = ({ task, action }: { task: Task; action: string }) => {
      const taskNpcId = task.npcId;
      if (taskNpcId !== npcId) return;

      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = task;
          return updated;
        }
        return [task, ...prev];
      });
    };

    const handleTaskDeleted = ({ taskId }: { taskId: string }) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    };

    socket.on("task:updated", handleTaskUpdated);
    socket.on("task:deleted", handleTaskDeleted);
    return () => { socket.off("task:updated", handleTaskUpdated); socket.off("task:deleted", handleTaskDeleted); };
  }, [socket, npcId]);

  const handleDelete = (taskId: string) => {
    if (!socket) return;
    socket.emit("task:delete", { taskId });
  };

  const activeTasks = tasks.filter((t) => t.status === "in_progress" || t.status === "pending");
  const doneTasks = tasks.filter((t) => t.status === "complete" || t.status === "cancelled");

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-body">{t("common.loading")}</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-body">
        {t("task.noTasks", { name: npcName })}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {activeTasks.length > 0 && (
        <>
          <div className="text-micro text-text-dim font-bold px-1">{t("task.active")} ({activeTasks.length})</div>
          {activeTasks.map((task) => (
            <TaskCard key={task.id} task={task} onDelete={handleDelete} />
          ))}
        </>
      )}
      {doneTasks.length > 0 && (
        <>
          <div className="text-micro text-text-dim font-bold px-1 mt-2">{t("task.done")} ({doneTasks.length})</div>
          {doneTasks.map((task) => (
            <TaskCard key={task.id} task={task} onDelete={handleDelete} />
          ))}
        </>
      )}
    </div>
  );
}
