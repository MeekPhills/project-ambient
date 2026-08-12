import { readFile } from "node:fs/promises";

const server = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
const required = ["$schema", "name", "description", "version", "repository"];
for (const field of required) {
  if (!server[field]) throw new Error(`server.json is missing ${field}`);
}
if (!Array.isArray(server.packages) || server.packages.length === 0) {
  throw new Error("server.json must declare at least one package.");
}
console.log(`server.json basic contract is valid for ${server.name}@${server.version}`);
