import { pathToFileURL } from "node:url";
import type { ReadStream, WriteStream } from "node:tty";
import {
  executeSupabaseBootstrap,
  planSupabaseBootstrap,
  safeBootstrapErrorMessage,
  SupabaseBootstrapError,
  type SupabaseAdminCredentialMode,
  type SupabaseBootstrapDependencies,
  type SupabaseBootstrapConfig,
} from "./bridge/supabase-bootstrap.js";
import {
  createVercelSensitiveSecretSink,
  type VercelSecretSinkDependencies,
  type VercelSensitiveSecretSink,
} from "./bridge/vercel-secret-sink.js";

export const SUPABASE_OWNER_CONFIRMATION_PHRASE =
  "project-ambient-control production POSTGRES_URL" as const;

export const SUPABASE_BOOTSTRAP_HELP = `Project Ambient Supabase/Vercel owner bootstrap

Usage:
  npm run bootstrap:supabase -- \\
    --pooler-host <aws-N-us-east-1.pooler.supabase.com> \\
    [--credential jit|password] [--execute]

Without --execute this command validates and prints only a fixed, redacted
topology. With --execute it reads a dedicated Vercel deployment token from a
hidden TTY, preflights the fixed Vercel team/project and the absence of
POSTGRES_URL, then reads the Supabase owner credential from the hidden TTY and
runs the one-shot bootstrap.

Secrets are never accepted in argv, environment variables, stdin pipes, a
Vercel CLI/configuration directory, or a child process. The live sink uses only
Node's in-process HTTPS fetch against the fixed Vercel API origin. JavaScript
memory clearing is best effort.
`;

const FORBIDDEN_ENVIRONMENT_KEYS = new Set([
  "ALL_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "MIGRATION_DATABASE_URL",
  "NODE_EXTRA_CA_CERTS",
  "NODE_DEBUG",
  "NODE_DEBUG_NATIVE",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "POSTGRES_URL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SSLKEYLOGFILE",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_DB_URL",
  "VERCEL_ACCESS_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TOKEN",
]);

export function assertSafeBootstrapEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const unsafeKey = Object.entries(environment).find(([key, value]) => {
    if (!value) return false;
    const normalized = key.toUpperCase();
    return FORBIDDEN_ENVIRONMENT_KEYS.has(normalized) || normalized.startsWith("PG");
  })?.[0];
  if (unsafeKey) {
    throw new SupabaseBootstrapError(
      `Refusing to handle credentials while unsafe environment variable ${unsafeKey} is set.`,
    );
  }
}

function requireValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new SupabaseBootstrapError(`${option} requires a value.`);
  }
  return value;
}

export function parseSupabaseBootstrapArgs(argv: readonly string[]):
  | { help: true }
  | { help: false; config: SupabaseBootstrapConfig } {
  let poolerHost: string | undefined;
  let credentialMode: SupabaseAdminCredentialMode = "jit";
  let execute = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--execute":
        execute = true;
        break;
      case "--pooler-host":
        poolerHost = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--credential": {
        const value = requireValue(argv, index, argument);
        if (value !== "jit" && value !== "password") {
          throw new SupabaseBootstrapError("--credential must be jit or password.");
        }
        credentialMode = value;
        index += 1;
        break;
      }
      default:
        throw new SupabaseBootstrapError(
          "Unsupported command-line option; secret-valued options are not accepted.",
        );
    }
  }

  if (help) return { help: true };
  if (!poolerHost) {
    throw new SupabaseBootstrapError("--pooler-host is required.");
  }
  const config: SupabaseBootstrapConfig = {
    poolerHost,
    credentialMode,
    execute,
  };
  // Planning is also the single validation boundary used by the CLI parser.
  planSupabaseBootstrap(config);
  return { help: false, config };
}

export interface SupabaseOwnerRunnerDependencies {
  environment?: NodeJS.ProcessEnv;
  readSecret?: (prompt: string) => Promise<string>;
  readConfirmation?: (prompt: string) => Promise<string>;
  createSecretSink?: (
    token: string,
    expectedPoolerHost: string,
    dependencies?: VercelSecretSinkDependencies,
  ) => VercelSensitiveSecretSink;
  vercel?: VercelSecretSinkDependencies;
  bootstrap?: SupabaseBootstrapDependencies;
}

export async function runSupabaseOwnerBootstrap(
  config: SupabaseBootstrapConfig,
  dependencies: SupabaseOwnerRunnerDependencies = {},
): Promise<void> {
  if (!config.execute) {
    throw new SupabaseBootstrapError("The owner runner requires --execute.");
  }
  // This gate runs before either prompt and before fetch, randomness, or SQL.
  assertSafeBootstrapEnvironment(dependencies.environment ?? process.env);
  const readSecret = dependencies.readSecret ?? ((prompt) => readHiddenTtyLine(prompt));
  const readConfirmation = dependencies.readConfirmation
    ?? ((prompt) => readVisibleTtyLine(prompt));
  const createSecretSink = dependencies.createSecretSink
    ?? createVercelSensitiveSecretSink;
  let vercelToken = "";
  let administratorCredential = "";
  let sink: VercelSensitiveSecretSink | undefined;
  try {
    vercelToken = await readSecret("Dedicated Vercel deployment token (hidden): ");
    sink = createSecretSink(vercelToken, config.poolerHost, dependencies.vercel);
    vercelToken = "";
    // Preflight must finish before requesting the database credential or
    // allowing the bootstrap library to generate random material or issue SQL.
    await sink.preflight();
    const confirmation = await readConfirmation(
      `Target: project-ambient-control / production / POSTGRES_URL\nType exactly "${SUPABASE_OWNER_CONFIRMATION_PHRASE}" to continue: `,
    );
    if (confirmation !== SUPABASE_OWNER_CONFIRMATION_PHRASE) {
      throw new SupabaseBootstrapError("Owner confirmation did not match; bootstrap cancelled.");
    }
    administratorCredential = await readSecret(
      config.credentialMode === "jit"
        ? "Supabase Temporary Access token (hidden): "
        : "Supabase database password (hidden): ",
    );
    await executeSupabaseBootstrap(config, administratorCredential, {
      ...dependencies.bootstrap,
      secretSink: async (payload) => sink!.write(payload),
    });
  } finally {
    vercelToken = "";
    administratorCredential = "";
    sink?.dispose();
  }
}

export async function readVisibleTtyLine(
  prompt: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new SupabaseBootstrapError(
      "A controlling TTY is required for the visible owner confirmation.",
    );
  }
  output.write(prompt);
  input.setEncoding("utf8");
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    const cleanup = (): void => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onError);
      input.pause();
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          value = "";
          finish(new SupabaseBootstrapError("Bootstrap cancelled."));
          return;
        }
        value += character;
        if (Buffer.byteLength(value, "utf8") > 256) {
          value = "";
          finish(new SupabaseBootstrapError("Owner confirmation exceeds the safe size limit."));
          return;
        }
      }
    };
    const onEnd = (): void => finish(
      new SupabaseBootstrapError("The controlling TTY closed during owner confirmation."),
    );
    const onError = (): void => finish(
      new SupabaseBootstrapError("The controlling TTY failed during owner confirmation."),
    );
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
  });
}

export async function readHiddenTtyLine(
  prompt: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new SupabaseBootstrapError(
      "A controlling TTY is required; credentials cannot be read from stdin pipes.",
    );
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);
    let settled = false;

    const cleanup = (): void => {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onInputError);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          value = "";
          finish(new SupabaseBootstrapError("Bootstrap cancelled."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u007f") value += character;
        if (Buffer.byteLength(value, "utf8") > 4_096) {
          value = "";
          finish(new SupabaseBootstrapError("Hidden input exceeds the safe size limit."));
          return;
        }
      }
    };
    const onEnd = (): void => {
      value = "";
      finish(new SupabaseBootstrapError("The controlling TTY closed during hidden input."));
    };
    const onInputError = (): void => {
      value = "";
      finish(new SupabaseBootstrapError("The controlling TTY failed during hidden input."));
    };

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onInputError);
  });
}

async function main(): Promise<void> {
  try {
    const parsed = parseSupabaseBootstrapArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(SUPABASE_BOOTSTRAP_HELP);
      return;
    }
    if (parsed.config.execute) {
      await runSupabaseOwnerBootstrap(parsed.config);
      process.stdout.write(
        "Bootstrap completed; fixed production POSTGRES_URL metadata was confirmed.\n",
      );
      return;
    }
    const plan = planSupabaseBootstrap(parsed.config);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeBootstrapErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
if (isMain) await main();
