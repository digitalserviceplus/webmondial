import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { parse } from "dotenv";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const localDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=public";
let existingEnvText = "";
let existingEnv = {};

try {
  existingEnvText = await readFile(envPath, "utf8");
  existingEnv = parse(existingEnvText);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const configuredSetupToken = process.env.INITIAL_SETUP_TOKEN?.trim() || existingEnv.INITIAL_SETUP_TOKEN?.trim();
const generatedSetupToken = !configuredSetupToken;
if (process.env.SASPAY_SECRET_KEY === undefined && existingEnv.SASPAY_SECRET_KEY) {
  process.env.SASPAY_SECRET_KEY = existingEnv.SASPAY_SECRET_KEY;
}
const defaults = {
  DATABASE_URL: localDatabaseUrl,
  AUTH_SECRET: randomBytes(32).toString("base64url"),
  AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  INITIAL_SETUP_TOKEN: randomBytes(32).toString("base64url"),
  PAYMENT_MODE: "mock",
  SASPAY_API_KEY: "",
  SASPAY_WEBHOOK_SECRET: "",
  APP_URL: "",
  EMAIL_SERVER_URL: "",
  EMAIL_FROM: "",
  WEBMONDIAL_LOCAL_DB: "embedded",
};
const linesToAdd = [];

for (const [key, value] of Object.entries(defaults)) {
  const configuredValue = process.env[key] ?? existingEnv[key];
  const optionalEmptyValue = ["SASPAY_API_KEY", "SASPAY_WEBHOOK_SECRET", "APP_URL"].includes(key) && configuredValue === "";
  const placeholderSecret = key === "AUTH_SECRET" && configuredValue?.startsWith("replace-with-");
  if (configuredValue === undefined || (!optionalEmptyValue && !configuredValue.trim()) || placeholderSecret) {
    linesToAdd.push(`${key}=${value}`);
    process.env[key] = value;
  } else {
    process.env[key] = configuredValue;
  }
}

if (linesToAdd.length > 0) {
  const prefix = existingEnvText.length > 0 ? "\n" : "";
  existingEnvText += `${prefix}${linesToAdd.join("\n")}\n`;
  await writeFile(envPath, existingEnvText, {
    encoding: "utf8",
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    socket.listen(port, "127.0.0.1", () => socket.close(() => resolve(true)));
  });
}

const nodeModules = path.join(root, "node_modules");
const prismaCli = path.join(nodeModules, "prisma", "build", "index.js");
const nextCli = path.join(nodeModules, "next", "dist", "bin", "next");
const node = process.execPath;
let db;
let databaseServer;
let nextProcess;
let nextExitPromise;
let closePromise;
let requestedExitCode;

async function closeServices() {
  if (!closePromise) {
    closePromise = (async () => {
      if (nextProcess && nextProcess.exitCode === null) {
        nextProcess.kill("SIGTERM");
        if (nextExitPromise) await nextExitPromise;
      }
      if (databaseServer) await databaseServer.stop();
      if (db) await db.close();
    })();
  }
  return closePromise;
}

try {
  const isLocalEmbeddedDatabase =
    process.env.WEBMONDIAL_LOCAL_DB === "embedded" || process.env.DATABASE_URL === localDatabaseUrl;
  if (isLocalEmbeddedDatabase) {
    let databasePort = 5432;
    while (databasePort < 5500 && !(await portAvailable(databasePort))) databasePort += 1;
    if (databasePort === 5500) throw new Error("Aucun port libre trouvé pour la base locale (5432–5499).");
    if (databasePort !== 5432) {
      const databaseUrl = new URL(process.env.DATABASE_URL);
      databaseUrl.port = String(databasePort);
      process.env.DATABASE_URL = databaseUrl.toString();
      existingEnvText = existingEnvText.replace(
        /^(\s*DATABASE_URL\s*=\s*).*$/m,
        `$1"${process.env.DATABASE_URL}"`,
      );
      await writeFile(envPath, existingEnvText, "utf8");
      console.info(`Le port 5432 est occupé ; base locale démarrée sur ${databasePort}.`);
    }
    await mkdir(path.join(root, ".local-data"), { recursive: true });
    db = await PGlite.create(path.join(root, ".local-data", "postgres"));
    databaseServer = new PGLiteSocketServer({ db, host: "127.0.0.1", maxConnections: 20, port: databasePort });
    await databaseServer.start();
    console.info("Base PostgreSQL locale démarrée (données conservées dans .local-data).");
  }

  await run(node, [prismaCli, "generate"]);
  await run(node, [prismaCli, "migrate", "deploy"]);

  const setupCheck = new Client({ connectionString: process.env.DATABASE_URL });
  await setupCheck.connect();
  const { rowCount } = await setupCheck.query('SELECT "id" FROM "User" WHERE "role" = \'SUPER_ADMIN\' LIMIT 1');
  await setupCheck.end();

  if (generatedSetupToken || rowCount === 0) {
    console.info(`Code initial de l’admin général (à saisir sur /configuration) : ${process.env.INITIAL_SETUP_TOKEN}`);
    console.info("Ce code reste dans le fichier .env local ignoré par Git.");
  }

  nextProcess = spawn(node, [nextCli, "dev", "--hostname", "127.0.0.1"], { cwd: root, env: process.env, stdio: "inherit" });
  nextExitPromise = new Promise((resolve, reject) => {
    nextProcess.once("error", reject);
    nextProcess.once("close", (code) => resolve(code ?? 1));
  });
  process.once("SIGINT", () => {
    requestedExitCode = 130;
    void closeServices();
  });
  process.once("SIGTERM", () => {
    requestedExitCode = 143;
    void closeServices();
  });
  const exitCode = await nextExitPromise;
  await closeServices();
  process.exitCode = requestedExitCode ?? exitCode;
} catch (error) {
  await closeServices();
  console.error("Impossible de démarrer Web Mondial.", error);
  process.exitCode = 1;
}
