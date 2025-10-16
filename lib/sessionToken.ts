import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface SessionTokenPayload {
  jti: string;
  scope: string;
  iat: number;
  exp: number;
}

export interface CreateSessionTokenOptions {
  scope: string;
  ttlSeconds?: number;
  now?: Date;
  secret?: string;
}

export interface VerifySessionTokenOptions {
  now?: Date;
  requiredScope?: string | string[];
  secret?: string;
}

export class TokenExpiredError extends Error {
  constructor(message = "Session token expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

export class TokenInvalidError extends Error {
  constructor(message = "Session token is invalid") {
    super(message);
    this.name = "TokenInvalidError";
  }
}

const DEFAULT_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;

export function createSessionToken(options: CreateSessionTokenOptions) {
  const { scope, ttlSeconds = DEFAULT_TTL_SECONDS, now = new Date(), secret = getSigningSecret() } = options;

  if (!scope || scope.trim() === "") {
    throw new TokenInvalidError("Scope is required");
  }

  if (ttlSeconds <= 0) {
    throw new TokenInvalidError("TTL must be greater than 0");
  }

  const boundedTtl = Math.min(ttlSeconds, MAX_TTL_SECONDS);
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const exp = issuedAtSeconds + boundedTtl;

  const payload: SessionTokenPayload = {
    jti: randomUUID(),
    scope,
    iat: issuedAtSeconds,
    exp,
  };

  const token = signPayload(payload, secret);
  return {
    token,
    scope,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifySessionToken(token: string, options: VerifySessionTokenOptions = {}): SessionTokenPayload {
  const { now = new Date(), requiredScope, secret = getSigningSecret() } = options;
  if (!token) {
    throw new TokenInvalidError("Token is required");
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new TokenInvalidError("Token format is invalid");
  }

  const [encodedHeader, encodedPayload, receivedSignature] = segments;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");

  if (!safeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) {
    throw new TokenInvalidError("Token signature mismatch");
  }

  try {
    const payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as SessionTokenPayload;
    assertValidPayload(payload, now, requiredScope);
    return payload;
  } catch (error) {
    if (error instanceof TokenInvalidError || error instanceof TokenExpiredError) {
      throw error;
    }
    throw new TokenInvalidError("Token payload could not be parsed");
  }
}

export function isSessionTokenExpired(payload: SessionTokenPayload, now = new Date()): boolean {
  return payload.exp * 1000 <= now.getTime();
}

function assertValidPayload(payload: SessionTokenPayload, now: Date, requiredScope?: string | string[]) {
  if (!payload || typeof payload !== "object") {
    throw new TokenInvalidError("Token payload missing");
  }

  if (!payload.exp || !payload.scope) {
    throw new TokenInvalidError("Token payload missing fields");
  }

  if (isSessionTokenExpired(payload, now)) {
    throw new TokenExpiredError();
  }

  if (requiredScope) {
    const scopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
    if (!scopes.includes(payload.scope)) {
      throw new TokenInvalidError("Token scope is not permitted");
    }
  }
}

function signPayload(payload: SessionTokenPayload, secret: string) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");
  return `${unsignedToken}.${signature}`;
}

function safeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getSigningSecret(): string {
  return process.env.REALTIME_SESSION_SECRET ?? process.env.APP_PASSWORD ?? "development-session-secret";
}
