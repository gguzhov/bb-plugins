export const MIGRATIONS = [
  `CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    user TEXT NOT NULL DEFAULT 'root' CHECK (user = 'root'),
    identity_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'up', 'down')),
    checked_at INTEGER,
    metrics_at INTEGER,
    error_code TEXT,
    error_text TEXT,
    uptime_seconds INTEGER,
    load1 REAL,
    load5 REAL,
    load15 REAL,
    cpu_percent REAL,
    mem_total_bytes INTEGER,
    mem_available_bytes INTEGER,
    disk_total_bytes INTEGER,
    disk_used_bytes INTEGER,
    check_started_at INTEGER,
    UNIQUE (host, port)
  )`,
  `ALTER TABLE servers ADD COLUMN icon_name TEXT NOT NULL DEFAULT 'Server'`,
  `ALTER TABLE servers ADD COLUMN icon_image TEXT`,
  `ALTER TABLE servers ADD COLUMN cpu_count INTEGER`,
  `ALTER TABLE servers ADD COLUMN swap_total_bytes INTEGER`,
  `ALTER TABLE servers ADD COLUMN swap_free_bytes INTEGER`,
  `ALTER TABLE servers ADD COLUMN procs_running INTEGER`,
  `ALTER TABLE servers ADD COLUMN procs_total INTEGER`,
  `ALTER TABLE servers ADD COLUMN net_rx_bps INTEGER`,
  `ALTER TABLE servers ADD COLUMN net_tx_bps INTEGER`,
  `ALTER TABLE servers ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE servers ADD COLUMN hosting TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE servers ADD COLUMN monthly_cost_rub INTEGER`,
  `ALTER TABLE servers ADD COLUMN server_group TEXT NOT NULL DEFAULT 'personal'`,
  `CREATE TABLE servers_next (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    user TEXT NOT NULL DEFAULT 'root' CHECK (user = 'root'),
    identity_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unchecked', 'up', 'down')),
    checked_at INTEGER,
    metrics_at INTEGER,
    error_code TEXT,
    error_text TEXT,
    uptime_seconds INTEGER,
    load1 REAL,
    load5 REAL,
    load15 REAL,
    cpu_percent REAL,
    mem_total_bytes INTEGER,
    mem_available_bytes INTEGER,
    disk_total_bytes INTEGER,
    disk_used_bytes INTEGER,
    check_started_at INTEGER,
    icon_name TEXT NOT NULL DEFAULT 'Server',
    icon_image TEXT,
    cpu_count INTEGER,
    swap_total_bytes INTEGER,
    swap_free_bytes INTEGER,
    procs_running INTEGER,
    procs_total INTEGER,
    net_rx_bps INTEGER,
    net_tx_bps INTEGER,
    description TEXT NOT NULL DEFAULT '',
    hosting TEXT NOT NULL DEFAULT '',
    monthly_cost_rub INTEGER,
    server_group TEXT NOT NULL DEFAULT 'personal',
    UNIQUE (host, port)
  );
  INSERT INTO servers_next (id, name, host, port, user, identity_path, created_at, updated_at, generation, status, checked_at, metrics_at, error_code, error_text, uptime_seconds, load1, load5, load15, cpu_percent, mem_total_bytes, mem_available_bytes, disk_total_bytes, disk_used_bytes, check_started_at, icon_name, icon_image, cpu_count, swap_total_bytes, swap_free_bytes, procs_running, procs_total, net_rx_bps, net_tx_bps, description, hosting, monthly_cost_rub, server_group)
    SELECT id, name, host, port, user, identity_path, created_at, updated_at, generation, status, checked_at, metrics_at, error_code, error_text, uptime_seconds, load1, load5, load15, cpu_percent, mem_total_bytes, mem_available_bytes, disk_total_bytes, disk_used_bytes, check_started_at, icon_name, icon_image, cpu_count, swap_total_bytes, swap_free_bytes, procs_running, procs_total, net_rx_bps, net_tx_bps, description, hosting, monthly_cost_rub, server_group FROM servers;
  DROP TABLE servers;
  ALTER TABLE servers_next RENAME TO servers;
  CREATE TABLE server_groups (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  INSERT INTO server_groups (id, label, position) VALUES ('personal', 'Personal', 0);
  INSERT INTO server_groups (id, label, position)
    SELECT server_group, server_group, ROW_NUMBER() OVER (ORDER BY server_group)
    FROM (SELECT DISTINCT server_group FROM servers WHERE server_group <> 'personal');`,
];

import type { Database } from "better-sqlite3";
import { t } from "./i18n.ts";
import type { Metrics } from "./remote.ts";
import { DEFAULT_GROUP, type ServerGroup } from "./groups.ts";

/**
 * Migration 13 first shipped with a CHECK that listed fixed group ids. When
 * groups became data its text was changed, so an install that applied the old
 * text has a recorded hash the host would reject as an edited migration. That
 * one known old hash is cleared before migrating; the host then adopts the
 * current text (its documented path for rows without a hash), and migration
 * 14 rebuilds the table without the old CHECK. Nothing else is touched.
 */
export const REWRITTEN_MIGRATIONS: ReadonlyArray<readonly [number, string]> = [
  [13, "7fb46cdb8f09a143207abf675a7f32f74e5e1f30be97e8b9ef7e8e87a922835e"],
];

export function forgetRewrittenMigrations(db: Database): void {
  const table = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_bb_migrations'`)
    .get();
  if (table === undefined) return;
  const columns = db.prepare(`PRAGMA table_info(_bb_migrations)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "statement_hash")) return;
  const clear = db.prepare(
    `UPDATE _bb_migrations SET statement_hash = NULL WHERE id = ? AND statement_hash = ?`,
  );
  for (const [id, oldHash] of REWRITTEN_MIGRATIONS) clear.run(id, oldHash);
}

export class GroupError extends Error {
  readonly code: "invalid" | "conflict" | "not_found";
  constructor(code: "invalid" | "conflict" | "not_found", message: string) {
    super(message);
    this.name = "GroupError";
    this.code = code;
  }
}

export type GroupWithCount = ServerGroup & { count: number };

export type ServerStatus = "unchecked" | "up" | "down";

export type ServerRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: "root";
  identityPath: string;
  createdAt: number;
  updatedAt: number;
  generation: number;
  status: ServerStatus;
  checkedAt: number | null;
  metricsAt: number | null;
  errorCode: string | null;
  errorText: string | null;
  uptimeSeconds: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuPercent: number | null;
  memTotalBytes: number | null;
  memAvailableBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  cpuCount: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  procsRunning: number | null;
  procsTotal: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
  checkStartedAt: number | null;
  iconName: string;
  iconImage: string | null;
  description: string;
  hosting: string;
  monthlyCostRub: number | null;
  group: string;
};

export class DuplicateServerError extends Error {
  constructor() {
    super(t("err.duplicate"));
    this.name = "DuplicateServerError";
  }
}

type SqlRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: "root";
  identity_path: string;
  created_at: number;
  updated_at: number;
  generation: number;
  status: ServerStatus;
  checked_at: number | null;
  metrics_at: number | null;
  error_code: string | null;
  error_text: string | null;
  uptime_seconds: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpu_percent: number | null;
  mem_total_bytes: number | null;
  mem_available_bytes: number | null;
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
  cpu_count: number | null;
  swap_total_bytes: number | null;
  swap_free_bytes: number | null;
  procs_running: number | null;
  procs_total: number | null;
  net_rx_bps: number | null;
  net_tx_bps: number | null;
  check_started_at: number | null;
  icon_name: string;
  icon_image: string | null;
  description: string;
  hosting: string;
  monthly_cost_rub: number | null;
  server_group: string;
};

function mapRow(row: SqlRow): ServerRow {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    user: "root",
    identityPath: row.identity_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    generation: row.generation,
    status: row.status,
    checkedAt: row.checked_at,
    metricsAt: row.metrics_at,
    errorCode: row.error_code,
    errorText: row.error_text,
    uptimeSeconds: row.uptime_seconds,
    load1: row.load1,
    load5: row.load5,
    load15: row.load15,
    cpuPercent: row.cpu_percent,
    memTotalBytes: row.mem_total_bytes,
    memAvailableBytes: row.mem_available_bytes,
    diskTotalBytes: row.disk_total_bytes,
    diskUsedBytes: row.disk_used_bytes,
    cpuCount: row.cpu_count,
    swapTotalBytes: row.swap_total_bytes,
    swapFreeBytes: row.swap_free_bytes,
    procsRunning: row.procs_running,
    procsTotal: row.procs_total,
    netRxBps: row.net_rx_bps,
    netTxBps: row.net_tx_bps,
    checkStartedAt: row.check_started_at,
    iconName: row.icon_name,
    iconImage: row.icon_image,
    description: row.description,
    hosting: row.hosting,
    monthlyCostRub: row.monthly_cost_rub,
    group: row.server_group,
  };
}

const SELECT = `SELECT id, name, host, port, user, identity_path, created_at, updated_at,
  generation, status, checked_at, metrics_at, error_code, error_text,
  uptime_seconds, load1, load5, load15, cpu_percent,
  mem_total_bytes, mem_available_bytes,   disk_total_bytes, disk_used_bytes, cpu_count, swap_total_bytes, swap_free_bytes,
  procs_running, procs_total, net_rx_bps, net_tx_bps,
  check_started_at, icon_name, icon_image, description, hosting, monthly_cost_rub, server_group FROM servers`;

export type NewServer = {
  id: string;
  name: string;
  host: string;
  port: number;
  identityPath: string;
  now: number;
  iconName?: string;
  iconImage?: string | null;
  description?: string;
  hosting?: string;
  monthlyCostRub?: number | null;
  group?: string;
};

export type ProbeWrite =
  | {
      status: "down";
      errorCode: string;
      errorText: string;
      now: number;
    }
  | {
      status: "up";
      errorCode: "partial" | null;
      errorText: string | null;
      metrics: Metrics;
      now: number;
    };

export function createStore(db: Database) {
  const listStmt = db.prepare(
    `${SELECT} ORDER BY CASE status WHEN 'down' THEN 0 WHEN 'unchecked' THEN 1 ELSE 2 END, name COLLATE NOCASE`,
  );
  const getStmt = db.prepare(`${SELECT} WHERE id = ?`);
  const byHostStmt = db.prepare(`${SELECT} WHERE host = ? AND port = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO servers (
      id, name, host, port, user, identity_path, created_at, updated_at, generation, status,
      icon_name, icon_image, description, hosting, monthly_cost_rub, server_group
    ) VALUES (?, ?, ?, ?, 'root', ?, ?, ?, 1, 'unchecked', ?, ?, ?, ?, ?, ?)`,
  );
  const renameStmt = db.prepare(
    `UPDATE servers SET name = ?, icon_name = ?, icon_image = ?, description = ?, hosting = ?,
      monthly_cost_rub = ?, server_group = ?, updated_at = ? WHERE id = ?`,
  );
  const retargetStmt = db.prepare(
    `UPDATE servers SET
      name = ?, host = ?, port = ?, identity_path = ?, icon_name = ?, icon_image = ?,
      description = ?, hosting = ?, monthly_cost_rub = ?, server_group = ?, updated_at = ?,
      generation = generation + 1, status = 'unchecked',
      checked_at = NULL, metrics_at = NULL, error_code = NULL, error_text = NULL,
      uptime_seconds = NULL, load1 = NULL, load5 = NULL, load15 = NULL, cpu_percent = NULL,
      mem_total_bytes = NULL, mem_available_bytes = NULL, disk_total_bytes = NULL,
      disk_used_bytes = NULL, cpu_count = NULL, swap_total_bytes = NULL, swap_free_bytes = NULL,
      procs_running = NULL, procs_total = NULL, net_rx_bps = NULL, net_tx_bps = NULL,
      check_started_at = NULL
    WHERE id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM servers WHERE id = ?`);
  const startStmt = db.prepare(
    `UPDATE servers SET check_started_at = ? WHERE id = ? AND generation = ?`,
  );
  const downStmt = db.prepare(
    `UPDATE servers SET status = 'down', checked_at = ?, error_code = ?, error_text = ?,
      check_started_at = NULL
     WHERE id = ? AND generation = ? AND check_started_at = ?`,
  );
  const upStmt = db.prepare(
    `UPDATE servers SET status = 'up', checked_at = ?, metrics_at = ?, error_code = ?, error_text = ?,
      uptime_seconds = ?, load1 = ?, load5 = ?, load15 = ?, cpu_percent = ?,
      mem_total_bytes = ?, mem_available_bytes = ?, disk_total_bytes = ?, disk_used_bytes = ?,
      cpu_count = ?, swap_total_bytes = ?, swap_free_bytes = ?,
      procs_running = ?, procs_total = ?, net_rx_bps = ?, net_tx_bps = ?,
      check_started_at = NULL
     WHERE id = ? AND generation = ? AND check_started_at = ?`,
  );
  const downCountStmt = db.prepare(`SELECT COUNT(*) AS count FROM servers WHERE status = 'down'`);
  const staleStmt = db.prepare(
    `${SELECT} WHERE checked_at IS NULL OR checked_at <= ?`,
  );
  const groupsStmt = db.prepare(
    `SELECT g.id, g.label, g.position, COUNT(s.id) AS count
     FROM server_groups g LEFT JOIN servers s ON s.server_group = g.id
     GROUP BY g.id ORDER BY g.position, g.label COLLATE NOCASE`,
  );
  const groupGetStmt = db.prepare(`SELECT id, label, position FROM server_groups WHERE id = ?`);
  const groupInsertStmt = db.prepare(
    `INSERT INTO server_groups (id, label, position)
     VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM server_groups))`,
  );
  const groupLabelStmt = db.prepare(`UPDATE server_groups SET label = ? WHERE id = ?`);
  const groupPositionStmt = db.prepare(`UPDATE server_groups SET position = ? WHERE id = ?`);
  const groupMoveStmt = db.prepare(
    `UPDATE servers SET server_group = ?, updated_at = ? WHERE server_group = ?`,
  );
  const groupDeleteStmt = db.prepare(`DELETE FROM server_groups WHERE id = ?`);

  function labelTaken(label: string, exceptId: string | null): boolean {
    const lower = label.toLocaleLowerCase("ru-RU");
    return (groupsStmt.all() as GroupWithCount[]).some(
      (group) => group.id !== exceptId && group.label.toLocaleLowerCase("ru-RU") === lower,
    );
  }

  const removeGroupTx = db.transaction((id: string, now: number): number => {
    const moved = groupMoveStmt.run(DEFAULT_GROUP, now, id).changes;
    groupDeleteStmt.run(id);
    return moved;
  });

  return {
    list(): ServerRow[] {
      return (listStmt.all() as SqlRow[]).map(mapRow);
    },
    get(id: string): ServerRow | null {
      const row = getStmt.get(id) as SqlRow | undefined;
      return row === undefined ? null : mapRow(row);
    },
    findByHostPort(host: string, port: number): ServerRow | null {
      const row = byHostStmt.get(host, port) as SqlRow | undefined;
      return row === undefined ? null : mapRow(row);
    },
    insert(input: NewServer): ServerRow {
      try {
        insertStmt.run(
          input.id,
          input.name,
          input.host,
          input.port,
          input.identityPath,
          input.now,
          input.now,
          input.iconName ?? "Server",
          input.iconImage ?? null,
          input.description ?? "",
          input.hosting ?? "",
          input.monthlyCostRub ?? null,
          input.group ?? DEFAULT_GROUP,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
          throw new DuplicateServerError();
        }
        throw error;
      }
      const row = this.get(input.id);
      if (row === null) throw new Error("insert failed");
      return row;
    },
    update(
      id: string,
      input: {
        name: string;
        host: string;
        port: number;
        identityPath: string;
        now: number;
        iconName: string;
        iconImage: string | null;
        description?: string;
        hosting?: string;
        monthlyCostRub?: number | null;
        group?: string;
      },
    ): ServerRow | null {
      const current = this.get(id);
      if (current === null) return null;
      const description = input.description ?? current.description;
      const hosting = input.hosting ?? current.hosting;
      const monthlyCostRub =
        input.monthlyCostRub === undefined ? current.monthlyCostRub : input.monthlyCostRub;
      const group = input.group ?? current.group;
      const sameTarget =
        current.host === input.host &&
        current.port === input.port &&
        current.identityPath === input.identityPath;
      if (sameTarget) {
        renameStmt.run(
          input.name,
          input.iconName,
          input.iconImage,
          description,
          hosting,
          monthlyCostRub,
          group,
          input.now,
          id,
        );
      }
      else {
        try {
          retargetStmt.run(
            input.name,
            input.host,
            input.port,
            input.identityPath,
            input.iconName,
            input.iconImage,
            description,
            hosting,
            monthlyCostRub,
            group,
            input.now,
            id,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "SQLITE_CONSTRAINT_UNIQUE"
          ) {
            throw new DuplicateServerError();
          }
          throw error;
        }
      }
      return this.get(id);
    },
    credentialsChanged(before: ServerRow, after: ServerRow): boolean {
      return (
        before.host !== after.host ||
        before.port !== after.port ||
        before.identityPath !== after.identityPath
      );
    },
    remove(id: string): boolean {
      return deleteStmt.run(id).changes === 1;
    },
    markStarted(id: string, generation: number, startedAt: number): boolean {
      return startStmt.run(startedAt, id, generation).changes === 1;
    },
    applyResult(
      id: string,
      generation: number,
      startedAt: number,
      outcome: ProbeWrite,
    ): boolean {
      if (outcome.status === "down") {
        return (
          downStmt.run(
            outcome.now,
            outcome.errorCode,
            outcome.errorText,
            id,
            generation,
            startedAt,
          ).changes === 1
        );
      }
      const metrics = outcome.metrics;
      return (
        upStmt.run(
          outcome.now,
          outcome.now,
          outcome.errorCode,
          outcome.errorText,
          metrics.uptimeSeconds,
          metrics.load1,
          metrics.load5,
          metrics.load15,
          metrics.cpuPercent,
          metrics.memTotalBytes,
          metrics.memAvailableBytes,
          metrics.diskTotalBytes,
          metrics.diskUsedBytes,
          metrics.cpuCount,
          metrics.swapTotalBytes,
          metrics.swapFreeBytes,
          metrics.procsRunning,
          metrics.procsTotal,
          metrics.netRxBps,
          metrics.netTxBps,
          id,
          generation,
          startedAt,
        ).changes === 1
      );
    },
    countDown(): number {
      const row = downCountStmt.get() as { count: number };
      return row.count;
    },
    listStale(checkedAtOrOlder: number): ServerRow[] {
      return (staleStmt.all(checkedAtOrOlder) as SqlRow[]).map(mapRow);
    },
    listGroups(): GroupWithCount[] {
      return groupsStmt.all() as GroupWithCount[];
    },
    getGroup(id: string): ServerGroup | null {
      return (groupGetStmt.get(id) as ServerGroup | undefined) ?? null;
    },
    /** `id` and `label` must already be validated; a repeated id or label is a conflict. */
    addGroup(id: string, label: string): ServerGroup {
      if (groupGetStmt.get(id) !== undefined) {
        throw new GroupError("conflict", t("err.groupIdTaken", { id }));
      }
      if (labelTaken(label, null)) throw new GroupError("conflict", t("err.groupTaken", { label }));
      groupInsertStmt.run(id, label);
      const row = this.getGroup(id);
      if (row === null) throw new Error("group insert failed");
      return row;
    },
    updateGroup(id: string, input: { label?: string; position?: number }): ServerGroup {
      if (this.getGroup(id) === null) throw new GroupError("not_found", t("err.groupMissing", { id }));
      if (input.label !== undefined) {
        if (labelTaken(input.label, id)) throw new GroupError("conflict", t("err.groupTaken", { label: input.label }));
        groupLabelStmt.run(input.label, id);
      }
      if (input.position !== undefined) groupPositionStmt.run(input.position, id);
      return this.getGroup(id) as ServerGroup;
    },
    /** Moves the group's servers to the default group, then deletes it. Returns how many moved. */
    removeGroup(id: string, now: number): number {
      if (id === DEFAULT_GROUP) {
        throw new GroupError("invalid", t("err.groupDefault"));
      }
      if (this.getGroup(id) === null) throw new GroupError("not_found", t("err.groupMissing", { id }));
      return removeGroupTx(id, now);
    },
  };
}

export type FleetStore = ReturnType<typeof createStore>;
