export const VERCEL_API_ORIGIN = "https://api.vercel.com" as const;
export const VERCEL_PROJECT_ID = "prj_npI783AvPfO2DIuZEbwhL2CYt5Vn" as const;
export const VERCEL_TEAM_ID = "team_m0flpJNmh3CYcXQcI82bKdsO" as const;
export const VERCEL_RUNTIME_ENV_KEY = "POSTGRES_URL" as const;

const VERCEL_ENV_TYPE = "sensitive" as const;
const VERCEL_ENV_TARGET = "production" as const;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
const RUNTIME_DATABASE = "postgres";
const RUNTIME_PORT = "6543";
const RUNTIME_ROLE_USERNAME = "ambient_runtime.mbcxfyekqyexpqshamwq";
const POOLER_HOST_PATTERN = /^aws-[0-9]+-us-east-1\.pooler\.supabase\.com$/;

export type VercelSecretSinkFailureOutcome = "definite-failure" | "ambiguous";

export class VercelSecretSinkError extends Error {
  readonly outcome: VercelSecretSinkFailureOutcome;

  constructor(outcome: VercelSecretSinkFailureOutcome, message: string) {
    super(message);
    this.name = "VercelSecretSinkError";
    this.outcome = outcome;
  }
}

export interface VercelSecretSinkDependencies {
  fetch?: typeof globalThis.fetch;
  delay?: (milliseconds: number) => Promise<void>;
  /** Test seam. The production owner runner always uses the fixed default. */
  requestTimeoutMs?: number;
}

export interface VercelSensitiveSecretSink {
  preflight(): Promise<void>;
  write(payload: { postgresUrl: string }): Promise<{ outcome: "confirmed" }>;
  dispose(): void;
}

class ResponsePayloadError extends Error {}
class RequestTimeoutError extends Error {}

interface JsonRequestOptions {
  method: "GET" | "POST";
  url: string;
  token: string;
  body?: Buffer;
  mutationMayHaveCommitted: boolean;
  expectedStatus: 200 | 201;
}

interface RequestDependencies {
  fetch: typeof globalThis.fetch;
  delay: (milliseconds: number) => Promise<void>;
  requestTimeoutMs: number;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function projectUrl(): string {
  const url = new URL(`/v9/projects/${VERCEL_PROJECT_ID}`, VERCEL_API_ORIGIN);
  url.searchParams.set("teamId", VERCEL_TEAM_ID);
  return url.toString();
}

function environmentUrl(): string {
  const url = new URL(`/v10/projects/${VERCEL_PROJECT_ID}/env`, VERCEL_API_ORIGIN);
  url.searchParams.set("teamId", VERCEL_TEAM_ID);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureForRequest(
  mutationMayHaveCommitted: boolean,
  message: string,
): VercelSecretSinkError {
  return new VercelSecretSinkError(
    mutationMayHaveCommitted ? "ambiguous" : "definite-failure",
    message,
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const advertisedLength = response.headers.get("content-length");
  if (advertisedLength !== null) {
    const parsedLength = Number(advertisedLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RESPONSE_BYTES) {
      throw new ResponsePayloadError();
    }
  }

  if (!response.body) throw new ResponsePayloadError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ResponsePayloadError();
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) throw new ResponsePayloadError();
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new ResponsePayloadError();
  } finally {
    bytes.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const value = response?.headers.get("retry-after")?.trim();
  if (value) {
    let milliseconds: number | undefined;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
      milliseconds = Math.ceil(Number(value) * 1_000);
    } else {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) milliseconds = Math.max(0, timestamp - Date.now());
    }
    if (milliseconds !== undefined && Number.isFinite(milliseconds)) {
      return Math.min(Math.max(0, milliseconds), MAX_RETRY_AFTER_MS);
    }
  }
  return DEFAULT_RETRY_DELAYS_MS[Math.min(attempt - 1, DEFAULT_RETRY_DELAYS_MS.length - 1)]!;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function attemptJsonRequest(
  options: JsonRequestOptions,
  dependencies: RequestDependencies,
): Promise<{ response: Response; json?: unknown }> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${options.token}`,
  };
  if (options.body) headers["content-type"] = "application/json";

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError());
    }, dependencies.requestTimeoutMs);
  });
  const operation = (async (): Promise<{ response: Response; json?: unknown }> => {
    const response = await dependencies.fetch(options.url, {
      method: options.method,
      headers,
      body: options.body as unknown as BodyInit | undefined,
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === options.expectedStatus) {
      return { response, json: await readBoundedJson(response) };
    }
    return { response };
  })();

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    headers.authorization = "";
    delete headers["content-type"];
  }
}

async function requestJson(
  options: JsonRequestOptions,
  dependencies: RequestDependencies,
): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response | undefined;
    try {
      const result = await attemptJsonRequest(options, dependencies);
      response = result.response;
      if (response.status === options.expectedStatus) return result.json;
      void response.body?.cancel().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) {
        throw failureForRequest(
          options.mutationMayHaveCommitted,
          "Vercel returned an unexpected successful status.",
        );
      }
      if (!isRetryableStatus(response.status)) {
        throw new VercelSecretSinkError(
          "definite-failure",
          "Vercel rejected the fixed secret request.",
        );
      }
    } catch (error) {
      if (error instanceof VercelSecretSinkError) throw error;
      if (error instanceof ResponsePayloadError) {
        throw failureForRequest(
          options.mutationMayHaveCommitted,
          "Vercel returned an invalid bounded JSON response.",
        );
      }
      if (options.mutationMayHaveCommitted) {
        throw new VercelSecretSinkError(
          "ambiguous",
          "Vercel did not produce a confirmable response after the secret mutation began.",
        );
      }
      if (attempt === MAX_ATTEMPTS) {
        throw failureForRequest(
          options.mutationMayHaveCommitted,
          "Vercel did not produce a confirmable response within the retry budget.",
        );
      }
      await dependencies.delay(retryDelay(undefined, attempt));
      continue;
    }

    if (options.mutationMayHaveCommitted) {
      throw new VercelSecretSinkError(
        "ambiguous",
        "Vercel did not produce a confirmable response after the secret mutation began.",
      );
    }
    if (attempt === MAX_ATTEMPTS) {
      throw failureForRequest(
        options.mutationMayHaveCommitted,
        "Vercel did not produce a confirmable response within the retry budget.",
      );
    }
    await dependencies.delay(retryDelay(response, attempt));
  }
  throw failureForRequest(
    options.mutationMayHaveCommitted,
    "Vercel request retry budget was exhausted.",
  );
}

function environmentRecords(
  json: unknown,
  outcome: VercelSecretSinkFailureOutcome = "definite-failure",
): Array<Record<string, unknown>> {
  if (!isRecord(json) || !Array.isArray(json.envs)) {
    throw new VercelSecretSinkError(
      outcome,
      "Vercel returned invalid environment metadata.",
    );
  }
  if (!json.envs.every(isRecord)) {
    throw new VercelSecretSinkError(
      outcome,
      "Vercel returned invalid environment metadata.",
    );
  }
  return json.envs;
}

function isExactProductionSensitiveMetadata(record: Record<string, unknown>): boolean {
  const target = record.target;
  const customEnvironmentIds = record.customEnvironmentIds;
  const secretVisibility = record.visibility === undefined
    || record.visibility === null
    || record.visibility === "secret";
  const exactProductionTarget = target === VERCEL_ENV_TARGET
    || (Array.isArray(target) && target.length === 1 && target[0] === VERCEL_ENV_TARGET);
  return record.key === VERCEL_RUNTIME_ENV_KEY
    && record.type === VERCEL_ENV_TYPE
    && secretVisibility
    && exactProductionTarget
    && (record.gitBranch === undefined || record.gitBranch === null)
    && (record.customEnvironmentId === undefined || record.customEnvironmentId === null)
    && (
      customEnvironmentIds === undefined
      || customEnvironmentIds === null
      || (Array.isArray(customEnvironmentIds) && customEnvironmentIds.length === 0)
    );
}

function assertProjectMetadata(json: unknown): void {
  if (
    !isRecord(json)
    || json.id !== VERCEL_PROJECT_ID
    || json.accountId !== VERCEL_TEAM_ID
  ) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The Vercel token did not resolve to the fixed project and team.",
    );
  }
}

function assertCompleteEnvironmentListing(
  json: unknown,
  outcome: VercelSecretSinkFailureOutcome,
): asserts json is Record<string, unknown> {
  const environmentCount = isRecord(json) && Array.isArray(json.envs)
    ? json.envs.length
    : -1;
  if (
    !isRecord(json)
    || (json.hiddenProductionEnvCount !== undefined
      && (
        !Number.isSafeInteger(json.hiddenProductionEnvCount)
        || Number(json.hiddenProductionEnvCount) !== 0
      ))
  ) {
    throw new VercelSecretSinkError(
      outcome,
      "Vercel could not prove that production POSTGRES_URL is absent.",
    );
  }
  if (json.pagination !== undefined) {
    if (
      !isRecord(json.pagination)
      || !Number.isSafeInteger(json.pagination.count)
      || Number(json.pagination.count) < 0
      || Number(json.pagination.count) !== environmentCount
      || json.pagination.next !== null
      || json.pagination.prev !== null
    ) {
      throw new VercelSecretSinkError(
        outcome,
        "Vercel environment pagination did not prove a complete collision check.",
      );
    }
  }
}

function assertNoExistingRuntimeEnvironment(json: unknown): void {
  assertCompleteEnvironmentListing(json, "definite-failure");
  const matches = environmentRecords(json, "definite-failure").filter(
    (record) => record.key === VERCEL_RUNTIME_ENV_KEY,
  );
  if (matches.length !== 0) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The fixed Vercel project already has a POSTGRES_URL entry; refusing overwrite.",
    );
  }
}

function assertConfirmedEnvironmentMetadata(json: unknown, createdId: string): void {
  assertCompleteEnvironmentListing(json, "ambiguous");
  const matches = environmentRecords(json, "ambiguous").filter(
    (record) => record.key === VERCEL_RUNTIME_ENV_KEY,
  );
  if (
    matches.length !== 1
    || matches[0]!.id !== createdId
    || !isExactProductionSensitiveMetadata(matches[0]!)
  ) {
    throw new VercelSecretSinkError(
      "ambiguous",
      "Vercel did not confirm the exact production-sensitive metadata.",
    );
  }
}

function createdEnvironmentId(json: unknown): string {
  if (!isRecord(json) || !Array.isArray(json.failed) || json.failed.length !== 0) {
    throw new VercelSecretSinkError(
      "ambiguous",
      "Vercel returned unconfirmable secret-write metadata.",
    );
  }
  const created = Array.isArray(json.created) ? json.created : [json.created];
  if (
    created.length !== 1
    || !isRecord(created[0])
    || !isExactProductionSensitiveMetadata(created[0])
  ) {
    throw new VercelSecretSinkError(
      "ambiguous",
      "Vercel returned unconfirmable secret-write metadata.",
    );
  }
  const id = created[0].id;
  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new VercelSecretSinkError(
      "ambiguous",
      "Vercel returned unconfirmable secret-write metadata.",
    );
  }
  return id;
}

export function assertCanonicalRuntimePostgresUrl(
  value: string,
  expectedPoolerHost: string,
): void {
  if (!POOLER_HOST_PATTERN.test(expectedPoolerHost)) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The expected Supabase runtime host is invalid.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The generated runtime URL is not canonical.",
    );
  }
  const parameters = Array.from(url.searchParams.entries());
  const password = url.password;
  const canonical = new URL("postgresql://placeholder.invalid/postgres");
  canonical.username = RUNTIME_ROLE_USERNAME;
  canonical.password = password;
  canonical.hostname = expectedPoolerHost;
  canonical.port = RUNTIME_PORT;
  canonical.searchParams.set("sslmode", "verify-full");

  if (
    url.protocol !== "postgresql:"
    || url.hostname !== expectedPoolerHost
    || !POOLER_HOST_PATTERN.test(url.hostname)
    || url.port !== RUNTIME_PORT
    || url.pathname !== `/${RUNTIME_DATABASE}`
    || url.username !== RUNTIME_ROLE_USERNAME
    || !/^[A-Za-z0-9_-]{64}$/.test(password)
    || url.hash !== ""
    || parameters.length !== 1
    || parameters[0]?.[0] !== "sslmode"
    || parameters[0]?.[1] !== "verify-full"
    || url.toString() !== canonical.toString()
    || value !== canonical.toString()
  ) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The generated runtime URL is not canonical.",
    );
  }
}

export function createVercelSensitiveSecretSink(
  tokenInput: string,
  expectedPoolerHost: string,
  dependencies: VercelSecretSinkDependencies = {},
): VercelSensitiveSecretSink {
  if (!/^[!-~]{20,4096}$/.test(tokenInput)) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The dedicated Vercel deployment token is invalid.",
    );
  }
  if (!POOLER_HOST_PATTERN.test(expectedPoolerHost)) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The expected Supabase runtime host is invalid.",
    );
  }
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The built-in HTTPS client is unavailable.",
    );
  }
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > REQUEST_TIMEOUT_MS) {
    throw new VercelSecretSinkError(
      "definite-failure",
      "The Vercel request timeout is invalid.",
    );
  }
  const requestDependencies: RequestDependencies = {
    fetch: fetchImplementation,
    delay: dependencies.delay ?? defaultDelay,
    requestTimeoutMs,
  };
  let token = tokenInput;
  tokenInput = "";
  let preflightComplete = false;
  let disposed = false;

  const requireAvailable = (): void => {
    if (disposed || token.length === 0) {
      throw new VercelSecretSinkError(
        "definite-failure",
        "The Vercel secret sink is no longer available.",
      );
    }
  };

  return {
    async preflight(): Promise<void> {
      requireAvailable();
      preflightComplete = false;
      const project = await requestJson({
        method: "GET",
        url: projectUrl(),
        token,
        mutationMayHaveCommitted: false,
        expectedStatus: 200,
      }, requestDependencies);
      assertProjectMetadata(project);
      const environments = await requestJson({
        method: "GET",
        url: environmentUrl(),
        token,
        mutationMayHaveCommitted: false,
        expectedStatus: 200,
      }, requestDependencies);
      assertNoExistingRuntimeEnvironment(environments);
      preflightComplete = true;
    },

    async write(payload: { postgresUrl: string }): Promise<{ outcome: "confirmed" }> {
      requireAvailable();
      if (!preflightComplete) {
        throw new VercelSecretSinkError(
          "definite-failure",
          "The Vercel secret sink preflight has not completed.",
        );
      }
      assertCanonicalRuntimePostgresUrl(payload.postgresUrl, expectedPoolerHost);
      const requestBody = Buffer.from(JSON.stringify({
        key: VERCEL_RUNTIME_ENV_KEY,
        value: payload.postgresUrl,
        type: VERCEL_ENV_TYPE,
        target: [VERCEL_ENV_TARGET],
      }), "utf8");
      try {
        const created = await requestJson({
          method: "POST",
          url: environmentUrl(),
          token,
          body: requestBody,
          mutationMayHaveCommitted: true,
          expectedStatus: 201,
        }, requestDependencies);
        const createdId = createdEnvironmentId(created);
        let confirmed: unknown;
        try {
          confirmed = await requestJson({
            method: "GET",
            url: environmentUrl(),
            token,
            mutationMayHaveCommitted: false,
            expectedStatus: 200,
          }, requestDependencies);
        } catch {
          throw new VercelSecretSinkError(
            "ambiguous",
            "Vercel could not confirm the committed secret metadata.",
          );
        }
        assertConfirmedEnvironmentMetadata(confirmed, createdId);
        return { outcome: "confirmed" };
      } finally {
        requestBody.fill(0);
      }
    },

    dispose(): void {
      token = "";
      preflightComplete = false;
      disposed = true;
    },
  };
}
