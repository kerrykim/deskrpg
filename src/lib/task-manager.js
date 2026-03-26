// src/lib/task-manager.js
// 태스크 DB CRUD. server.js에서 공유 db + schema를 받아 사용.

"use strict";

const { eq, and, desc, sql, getTableColumns } = require("drizzle-orm");

/** Drizzle camelCase 행을 정규화 (JOIN 결과의 npcName 포함 처리) */
function normalizeTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    channelId: row.channelId,
    npcId: row.npcId,
    assignerId: row.assignerId,
    npcTaskId: row.npcTaskId,
    title: row.title,
    summary: row.summary,
    status: row.status,
    npcName: row.npcName || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

class TaskManager {
  /**
   * @param {import('drizzle-orm').LibSQLDatabase | import('drizzle-orm/node-postgres').NodePgDatabase} db
   * @param {{ tasks: any, npcs: any }} schema
   */
  constructor(db, schema) {
    this.db = db;
    this.schema = schema;
  }

  /**
   * 태스크 액션 처리 (create/update/complete/cancel)
   * 멱등성: create 중복 시 upsert, update/complete 대상 없으면 auto-create.
   */
  async handleTaskAction(taskAction, channelId, npcId, assignerId) {
    const { action, id: npcTaskId, title, summary, status } = taskAction;

    switch (action) {
      case "create":
        return this._upsertTask(channelId, npcId, assignerId, npcTaskId, title, summary, status || "in_progress");
      case "update":
        return this._updateOrCreate(channelId, npcId, assignerId, npcTaskId, title, summary, status || "in_progress");
      case "complete":
        return this._updateOrCreate(channelId, npcId, assignerId, npcTaskId, title, summary, "complete");
      case "cancel":
        return this._updateOrCreate(channelId, npcId, assignerId, npcTaskId, title, summary, "cancelled");
      default:
        console.warn(`[TaskManager] Unknown action: ${action}`);
        return null;
    }
  }

  async _upsertTask(channelId, npcId, assignerId, npcTaskId, title, summary, status) {
    const { db, schema } = this;
    const completedAt = (status === "complete" || status === "cancelled") ? new Date() : null;

    const [row] = await db
      .insert(schema.tasks)
      .values({
        channelId,
        npcId,
        assignerId,
        npcTaskId,
        title,
        summary,
        status,
        completedAt,
      })
      .onConflictDoUpdate({
        target: [schema.tasks.npcId, schema.tasks.npcTaskId],
        set: {
          title: sql`COALESCE(excluded.title, ${schema.tasks.title})`,
          summary: sql`COALESCE(excluded.summary, ${schema.tasks.summary})`,
          status: sql`excluded.status`,
          updatedAt: new Date(),
          completedAt: sql`excluded.completed_at`,
        },
      })
      .returning();

    return normalizeTask(row);
  }

  async _updateOrCreate(channelId, npcId, assignerId, npcTaskId, title, summary, status) {
    const { db, schema } = this;
    const completedAt = (status === "complete" || status === "cancelled") ? new Date() : null;

    const rows = await db
      .update(schema.tasks)
      .set({
        title: title != null ? title : sql`${schema.tasks.title}`,
        summary: summary != null ? summary : sql`${schema.tasks.summary}`,
        status,
        updatedAt: new Date(),
        completedAt,
      })
      .where(
        and(
          eq(schema.tasks.npcId, npcId),
          eq(schema.tasks.npcTaskId, npcTaskId)
        )
      )
      .returning();

    if (rows.length > 0) return normalizeTask(rows[0]);
    return this._upsertTask(channelId, npcId, assignerId, npcTaskId, title, summary, status);
  }

  async getTasksByChannel(channelId) {
    const { db, schema } = this;

    const rows = await db
      .select({
        ...getTableColumns(schema.tasks),
        npcName: schema.npcs.name,
      })
      .from(schema.tasks)
      .leftJoin(schema.npcs, eq(schema.tasks.npcId, schema.npcs.id))
      .where(eq(schema.tasks.channelId, channelId))
      .orderBy(desc(schema.tasks.createdAt));

    return rows.map(normalizeTask);
  }

  async deleteTask(taskId, channelId) {
    const { db, schema } = this;

    const [row] = await db
      .delete(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.channelId, channelId)
        )
      )
      .returning();

    return normalizeTask(row);
  }

  async getTasksByNpc(npcId) {
    const { db, schema } = this;

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.npcId, npcId))
      .orderBy(desc(schema.tasks.createdAt));

    return rows.map(normalizeTask);
  }
}

module.exports = { TaskManager };
