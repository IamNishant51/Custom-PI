import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseError } from "../errors";
import { PATHS } from "../config";
import os from "node:os";
import { bus, Topics } from "../event-bus/event-bus";

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: any;
  primaryKey: boolean;
  foreignKey?: { table: string; column: string };
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  sizeBytes: number;
  indexes: string[];
}

interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
  estimatedImprovement: string;
}

interface Migration {
  id: string;
  name: string;
  up: string;
  down: string;
  createdAt: number;
  applied: boolean;
  appliedAt?: number;
}

export class DatabaseIntelligence {
  private migrations: Migration[] = [];
  private migrationsDir: string;

  constructor() {
    this.migrationsDir = PATHS.MIGRATIONS;
    if (!fs.existsSync(this.migrationsDir)) fs.mkdirSync(this.migrationsDir, { recursive: true });
  }

  analyzeSQLite(dbPath: string): { tables: TableInfo[]; suggestions: IndexSuggestion[] } {
    if (!fs.existsSync(dbPath)) throw new DatabaseError(`Database not found: ${dbPath}`);

    const tables: TableInfo[] = [];
    const suggestions: IndexSuggestion[] = [];

    const tableNames = this.querySQLite(dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");

    for (const row of tableNames) {
      const name = row.name;
      const columns = this.getColumns(dbPath, name);
      const rowCount = this.querySQLite(dbPath, `SELECT COUNT(*) as c FROM "${name}"`)[0]?.c || 0;
      const size = this.querySQLite(dbPath, `SELECT SUM("pgsize") as s FROM dbstat WHERE name="${name}"`)[0]?.s || 0;
      const indexes = this.querySQLite(dbPath, `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name="${name}"`).map((r: any) => r.name);

      tables.push({ name, columns, rowCount, sizeBytes: size, indexes });

      const fkColumns = columns.filter(c => c.foreignKey);
      for (const fk of fkColumns) {
        const hasIndex = indexes.some(i => i.includes(fk.name));
        if (!hasIndex && rowCount > 1000) {
          suggestions.push({
            table: name,
            columns: [fk.name],
            reason: `Foreign key column '${fk.name}' referencing '${fk.foreignKey?.table}' is not indexed`,
            estimatedImprovement: "JOIN performance improvement expected",
          });
        }
      }

      const textColumns = columns.filter(c => c.type.includes("TEXT") || c.type.includes("VARCHAR"));
      for (const tc of textColumns) {
        if (tc.name.toLowerCase().includes("email") || tc.name.toLowerCase().includes("name") || tc.name.toLowerCase().includes("title")) {
          const hasIndex = indexes.some(i => i.includes(tc.name));
          if (!hasIndex && rowCount > 5000) {
            suggestions.push({
              table: name,
              columns: [tc.name],
              reason: `High-cardinality text column '${tc.name}' frequently used in WHERE clauses`,
              estimatedImprovement: "Lookup queries on this column will be faster",
            });
          }
        }
      }
    }

    return { tables, suggestions };
  }

  createMigration(name: string, upSQL: string, downSQL: string): Migration {
    const id = `mig_${Date.now()}`;
    const migration: Migration = {
      id,
      name: name.replace(/\s+/g, "_").toLowerCase(),
      up: upSQL,
      down: downSQL,
      createdAt: Date.now(),
      applied: false,
    };
    this.migrations.push(migration);
    this.persistMigration(migration);
    return migration;
  }

  applyMigration(dbPath: string, migrationId: string): boolean {
    const migration = this.migrations.find(m => m.id === migrationId);
    if (!migration || migration.applied) return false;
    try {
      this.execSQLite(dbPath, migration.up);
      migration.applied = true;
      migration.appliedAt = Date.now();
      this.persistMigration(migration);
      return true;
    } catch (err: any) {
      throw new DatabaseError(`Migration failed: ${err.message}`, { cause: err });
    }
  }

  rollbackMigration(dbPath: string, migrationId: string): boolean {
    const migration = this.migrations.find(m => m.id === migrationId);
    if (!migration || !migration.applied) return false;
    try {
      this.execSQLite(dbPath, migration.down);
      migration.applied = false;
      migration.appliedAt = undefined;
      this.persistMigration(migration);
      return true;
    } catch (err: any) {
      throw new DatabaseError(`Rollback failed: ${err.message}`, { cause: err });
    }
  }

  getMigrations(): Migration[] {
    return this.migrations;
  }

  getPendingMigrations(): Migration[] {
    return this.migrations.filter(m => !m.applied);
  }

  suggestIndex(dbPath: string, table: string, columns: string[]): IndexSuggestion {
    return {
      table,
      columns,
      reason: `Suggested composite index for query pattern`,
      estimatedImprovement: "Query performance will improve for index-covered queries",
    };
  }

  createIndex(dbPath: string, table: string, columns: string[], unique = false): boolean {
    const indexName = `idx_${table}_${columns.join("_")}`;
    const uniqueStr = unique ? "UNIQUE " : "";
    try {
      this.execSQLite(dbPath, `CREATE ${uniqueStr}INDEX IF NOT EXISTS "${indexName}" ON "${table}" (${columns.map(c => `"${c}"`).join(", ")})`);
      return true;
    } catch {
      return false;
    }
  }

  analyzeQuery(dbPath: string, query: string): { plan: string; warnings: string[]; suggestions: string[] } {
    const warnings: string[] = [];
    const suggestions: string[] = [];

    const queryLower = query.toLowerCase();

    if (queryLower.includes("select *")) warnings.push("Avoid SELECT * — specify columns explicitly");

    if (!queryLower.includes("where") && queryLower.startsWith("select")) warnings.push("Query has no WHERE clause — may be reading entire table");

    if (queryLower.includes("like '%") || queryLower.includes("like '%")) warnings.push("Leading wildcard LIKE prevents index usage");

    if (queryLower.includes("not in")) suggestions.push("Consider using NOT EXISTS instead of NOT IN for better performance");

    let plan = "";
    try {
      plan = this.querySQLite(dbPath, `EXPLAIN QUERY PLAN ${query}`).map((r: any) => r.detail).join("\n");
    } catch {
      plan = "Could not explain query plan";
    }

    if (plan.toLowerCase().includes("scan")) warnings.push("Full table scan detected — consider adding an index");
    if (plan.toLowerCase().includes("temp")) suggestions.push("Query creates temporary tables — consider optimizing with indexes");

    return { plan, warnings, suggestions };
  }

  generateBackup(dbPath: string, backupPath?: string): string {
    const dest = backupPath || dbPath.replace(".db", `.backup.${Date.now()}.db`);
    execSync(`cp "${dbPath}" "${dest}"`, { timeout: 30000 });
    return dest;
  }

  private getColumns(dbPath: string, table: string): ColumnInfo[] {
    const rows = this.querySQLite(dbPath, `PRAGMA table_info("${table}")`);
    const fkInfo = this.querySQLite(dbPath, `PRAGMA foreign_key_list("${table}")`);

    return rows.map((row: any) => {
      const fk = fkInfo.find((f: any) => f.from === row.name);
      return {
        name: row.name,
        type: row.type,
        nullable: !row.notnull,
        default: row.dflt_value,
        primaryKey: !!row.pk,
        foreignKey: fk ? { table: fk.table, column: fk.to } : undefined,
      };
    });
  }

  private querySQLite(dbPath: string, sql: string): any[] {
    const result = execSync(`sqlite3 -json "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8", timeout: 10000 });
    try { return JSON.parse(result); } catch { return []; }
  }

  private execSQLite(dbPath: string, sql: string): void {
    execSync(`sqlite3 "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, { timeout: 10000 });
  }

  private persistMigration(migration: Migration): void {
    const filePath = path.join(this.migrationsDir, `${migration.id}_${migration.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(migration, null, 2));
  }
}

export const databaseIntelligence = new DatabaseIntelligence();
