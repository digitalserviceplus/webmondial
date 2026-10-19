import { spawnSync } from "node:child_process";
import process from "node:process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is required to run the Vercel build.");
}

function runNpm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.VERCEL_ENV === "production") {
  console.info("Applying pending Prisma migrations for the production deployment.");
  runNpm(["run", "db:deploy"]);
}

runNpm(["run", "build"]);
