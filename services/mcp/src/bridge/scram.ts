import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes as nodeRandomBytes,
} from "node:crypto";

export const POSTGRES_SCRAM_ITERATIONS = 4_096;
export const POSTGRES_SCRAM_SALT_BYTES = 16;
export const RUNTIME_PASSWORD_BYTES = 48;

export interface ScramVerifierOptions {
  iterations?: number;
  salt?: Uint8Array;
}

function hmacSha256(key: Uint8Array, message: string): Buffer {
  return createHmac("sha256", key).update(message, "utf8").digest();
}

/**
 * Build the exact verifier format PostgreSQL accepts for a SCRAM-SHA-256 role
 * password. The bootstrap password is generated from printable ASCII, so it
 * does not need lossy SASLprep handling in this narrowly scoped helper.
 */
export function derivePostgresScramVerifier(
  password: string,
  options: ScramVerifierOptions = {},
): string {
  if (password.length === 0 || password.includes("\0")) {
    throw new Error("The runtime password must be non-empty and contain no NUL bytes.");
  }

  const iterations = options.iterations ?? POSTGRES_SCRAM_ITERATIONS;
  if (!Number.isSafeInteger(iterations) || iterations < POSTGRES_SCRAM_ITERATIONS) {
    throw new Error(
      `SCRAM iterations must be an integer of at least ${POSTGRES_SCRAM_ITERATIONS}.`,
    );
  }

  const salt = Buffer.from(
    options.salt ?? nodeRandomBytes(POSTGRES_SCRAM_SALT_BYTES),
  );
  if (salt.length < POSTGRES_SCRAM_SALT_BYTES) {
    salt.fill(0);
    throw new Error(
      `The SCRAM salt must contain at least ${POSTGRES_SCRAM_SALT_BYTES} bytes.`,
    );
  }

  const passwordBytes = Buffer.from(password, "utf8");
  let saltedPassword: Buffer | undefined;
  let clientKey: Buffer | undefined;
  let storedKey: Buffer | undefined;
  let serverKey: Buffer | undefined;

  try {
    saltedPassword = pbkdf2Sync(
      passwordBytes,
      salt,
      iterations,
      32,
      "sha256",
    );
    clientKey = hmacSha256(saltedPassword, "Client Key");
    storedKey = createHash("sha256").update(clientKey).digest();
    serverKey = hmacSha256(saltedPassword, "Server Key");

    return [
      `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}`,
      `${storedKey.toString("base64")}:${serverKey.toString("base64")}`,
    ].join("$");
  } finally {
    passwordBytes.fill(0);
    salt.fill(0);
    saltedPassword?.fill(0);
    clientKey?.fill(0);
    storedKey?.fill(0);
    serverKey?.fill(0);
  }
}

export function generateRuntimePassword(
  randomBytes: (size: number) => Buffer = nodeRandomBytes,
): string {
  const bytes = randomBytes(RUNTIME_PASSWORD_BYTES);
  if (bytes.length !== RUNTIME_PASSWORD_BYTES) {
    bytes.fill(0);
    throw new Error(
      `The random source must return exactly ${RUNTIME_PASSWORD_BYTES} bytes.`,
    );
  }

  try {
    return bytes.toString("base64url");
  } finally {
    bytes.fill(0);
  }
}

export function isPostgresScramVerifier(value: string): boolean {
  return /^SCRAM-SHA-256\$[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(
    value,
  );
}
