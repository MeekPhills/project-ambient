import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stage = resolve(root, ".mcpb-stage");
const output = resolve(root, "project-ambient-control.mcpb");
const npmCache = resolve(root, ".npm-cache");

function run(command, args, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, npm_config_cache: npmCache },
  });
  return new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveCode() : reject(new Error(`${command} exited with ${code ?? 1}`)));
  });
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const entry of ["package.json", "package-lock.json", "LICENSE"]) {
  await cp(resolve(root, entry), resolve(stage, entry), { recursive: true });
}
await cp(resolve(root, "dist/src"), resolve(stage, "dist/src"), { recursive: true });
await cp(resolve(root, "packaging/mcpb/manifest.json"), resolve(stage, "manifest.json"));
await run("npm", ["ci", "--omit=dev", "--ignore-scripts"], stage);

try {
  await run("npx", ["--yes", "@anthropic-ai/mcpb", "pack", stage, output]);
} finally {
  await rm(stage, { recursive: true, force: true });
}
