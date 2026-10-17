import { PGlite } from "@electric-sql/pglite";
import { config } from "dotenv";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const root = process.cwd();
config({ path: path.join(root, ".env.migration.local"), quiet: true });

type SourceQueryResult = {
  rows: Array<Record<string, unknown>>;
  fields: Array<{ name: string }>;
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function redactConnectionStrings(value: string) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://[redacted]");
}

function orderedTables(tables: string[], foreignKeys: Array<{ table_name: string; foreign_table_name: string }>) {
  const remaining = new Set(tables);
  const dependencies = new Map(tables.map((table) => [table, new Set<string>()]));
  for (const relation of foreignKeys) {
    if (relation.table_name !== relation.foreign_table_name && remaining.has(relation.table_name) && remaining.has(relation.foreign_table_name)) {
      dependencies.get(relation.table_name)?.add(relation.foreign_table_name);
    }
  }

  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) =>
      [...(dependencies.get(table) ?? [])].every((dependency) => !remaining.has(dependency)),
    );
    if (ready.length === 0) throw new Error("Foreign-key cycle detected; refusing a partial import.");
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

async function listApplicationTables(database: PGlite | Client) {
  const sql = `SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  if (database instanceof PGlite) {
    const result = await database.query<{ table_name: string }>(sql);
    return result.rows.map(({ table_name }) => table_name);
  }
  const result = await database.query<{ table_name: string }>(sql);
  return result.rows.map(({ table_name }) => table_name);
}

async function countRows(database: PGlite | Client, table: string) {
  const sql = `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`;
  if (database instanceof PGlite) {
    const result = await database.query<{ count: string }>(sql);
    return Number(result.rows[0]?.count ?? 0);
  }
  const result = await database.query<{ count: string }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

async function readSourceDependencies(source: PGlite) {
  const result = await source.query<{ table_name: string; foreign_table_name: string }>(
    `SELECT DISTINCT tc.table_name, ccu.table_name AS foreign_table_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
       AND tc.table_name = kcu.table_name
     JOIN information_schema.constraint_column_usage AS ccu
       ON tc.constraint_name = ccu.constraint_name
       AND tc.constraint_schema = ccu.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
       AND ccu.table_schema = 'public'`,
  );
  return result.rows;
}

async function assertEmptyTarget(target: Client) {
  const tables = await listApplicationTables(target);
  for (const table of tables) {
    const count = await countRows(target, table);
    if (count > 0) throw new Error(`Target Neon table ${table} is not empty; refusing to overwrite data.`);
  }
}

function applyPrismaMigrations(connectionString: string) {
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      DOTENV_CONFIG_PATH: path.join(root, ".env.example"),
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostic = redactConnectionStrings(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
    throw new Error(`Prisma migrations failed${diagnostic ? `:\n${diagnostic.slice(-4000)}` : "."}`);
  }
  console.info("Committed Prisma migrations are applied to Neon.");
}

async function importRows(source: PGlite, target: Client, tables: string[]) {
  const chunkSize = 400;
  const importedCounts = new Map<string, number>();
  await target.query("BEGIN");
  try {
    for (const table of tables) {
      const quotedTable = quoteIdentifier(table);
      const description = await source.query(`SELECT * FROM ${quotedTable} LIMIT 0`) as SourceQueryResult;
      const columns = description.fields.map(({ name }) => name);
      if (columns.length === 0) throw new Error(`Source table ${table} has no columns.`);

      let offset = 0;
      let imported = 0;
      while (true) {
        const batch = await source.query(
          `SELECT * FROM ${quotedTable} LIMIT $1 OFFSET $2`,
          [chunkSize, offset],
        ) as SourceQueryResult;
        if (batch.rows.length === 0) break;

        const columnSql = columns.map(quoteIdentifier).join(", ");
        const rowSql = batch.rows.map((_, rowIndex) => {
          const placeholders = columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`);
          return `(${placeholders.join(", ")})`;
        }).join(", ");
        const values = batch.rows.flatMap((row) => columns.map((column) => row[column] ?? null));
        await target.query(
          `INSERT INTO ${quotedTable} (${columnSql}) VALUES ${rowSql}`,
          values,
        );
        imported += batch.rows.length;
        offset += batch.rows.length;
      }
      importedCounts.set(table, imported);
    }
    await target.query("COMMIT");
  } catch (error) {
    await target.query("ROLLBACK");
    throw error;
  }
  return importedCounts;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sourceDirectory = path.join(root, ".local-data", "postgres");
  let source: PGlite | undefined = await PGlite.create(sourceDirectory);
  let target: Client | undefined;
  try {
    const sourceTables = await listApplicationTables(source);
    if (sourceTables.length === 0) throw new Error("No local application tables were found.");
    const dependencies = await readSourceDependencies(source);
    const tables = orderedTables(sourceTables, dependencies);
    const sourceCounts = new Map<string, number>();
    for (const table of tables) sourceCounts.set(table, await countRows(source, table));

    console.info("Local database row counts:");
    for (const table of tables) console.info(`  ${table}: ${sourceCounts.get(table)}`);
    if (!apply) {
      console.info("Preflight only. No database was changed. Use npm run neon:import to start the backed-up import.");
      return;
    }

    const connectionString = process.env.NEON_DIRECT_URL?.trim();
    if (!connectionString) throw new Error("Add the unpooled Neon URL as NEON_DIRECT_URL in .env.migration.local.");
    const targetUrl = new URL(connectionString);
    if (targetUrl.protocol !== "postgres:" && targetUrl.protocol !== "postgresql:") {
      throw new Error("NEON_DIRECT_URL must use PostgreSQL.");
    }
    if (!targetUrl.hostname.endsWith(".neon.tech") || targetUrl.hostname.includes("-pooler")) {
      throw new Error("Use the direct, unpooled Neon connection string for the data import.");
    }

    target = new Client({ connectionString, connectionTimeoutMillis: 15_000 });
    await target.connect();
    await assertEmptyTarget(target);

    await source.exec("CHECKPOINT");
    const backupDirectory = path.join(
      root,
      ".local-data",
      "migration-backups",
      `postgres-before-neon-${new Date().toISOString().replaceAll(":", "-")}`,
    );
    await mkdir(path.dirname(backupDirectory), { recursive: true });
    await source.close();
    source = undefined;
    await cp(sourceDirectory, backupDirectory, { recursive: true, errorOnExist: true, force: false });
    console.info(`Local database backup created at ${path.relative(root, backupDirectory)}.`);

    source = await PGlite.create(sourceDirectory);
    await target.end();
    target = undefined;
    applyPrismaMigrations(connectionString);
    target = new Client({ connectionString, connectionTimeoutMillis: 15_000 });
    await target.connect();
    const targetTables = await listApplicationTables(target);
    const missingTables = sourceTables.filter((table) => !targetTables.includes(table));
    const unexpectedTables = targetTables.filter((table) => !sourceTables.includes(table));
    if (missingTables.length || unexpectedTables.length) {
      throw new Error(
        `Neon schema does not match the local schema. Missing: ${missingTables.join(", ") || "none"}; unexpected: ${unexpectedTables.join(", ") || "none"}.`,
      );
    }
    await assertEmptyTarget(target);

    const importedCounts = await importRows(source, target, tables);
    for (const table of tables) {
      const expected = sourceCounts.get(table) ?? 0;
      const imported = importedCounts.get(table) ?? 0;
      const actual = await countRows(target, table);
      if (imported !== expected || actual !== expected) {
        throw new Error(`Row count verification failed for ${table}; inspect the local backup before retrying.`);
      }
    }
    console.info("Neon import completed and all table row counts match the local database.");
  } finally {
    if (target) await target.end();
    if (source) await source.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error.";
  console.error("Neon database migration failed.", redactConnectionStrings(message));
  process.exitCode = 1;
});
