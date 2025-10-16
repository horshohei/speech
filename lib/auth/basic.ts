import { Buffer } from "node:buffer";

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

/**
 * Parse a Basic authorization header and return the credentials.
 * Returns null when the header is malformed or missing required data.
 */
export function parseBasicAuthHeader(header: string | null | undefined): BasicAuthCredentials | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(" ");
  if (!scheme || !value || scheme.toLowerCase() !== "basic") {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return { username, password };
  } catch {
    return null;
  }
}

export function verifyAppPassword(password: string | undefined | null): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return false;
  }
  return timingSafeCompare(password ?? "", expected);
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
