import { NextRequest, NextResponse } from "next/server";
import { z } from "@/lib/zod";

import { parseBasicAuthHeader, verifyAppPassword } from "@/lib/auth/basic";
import {
  TokenExpiredError,
  TokenInvalidError,
  createSessionToken,
  verifySessionToken,
} from "@/lib/sessionToken";

export const runtime = "nodejs";

const sessionRequestSchema = z.object({
  scope: z.string().min(1).default("practice"),
  ttlSeconds: z.number().int().min(1).max(600).optional(),
});

const sessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "expiresAt must be an ISO timestamp"),
  scope: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return unauthorizedResponse();
  }

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return handleBearerToken(authHeader);
  }

  const credentials = parseBasicAuthHeader(authHeader);
  if (!credentials || !verifyAppPassword(credentials.password)) {
    return unauthorizedResponse();
  }

  const requestBody = await parseRequestBody(request);
  if (!requestBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: requestBody.error.format() },
      { status: 400 },
    );
  }

  const { scope, ttlSeconds } = requestBody.data;
  const { token, expiresAt } = createSessionToken({ scope, ttlSeconds });
  const response = sessionResponseSchema.parse({ token, expiresAt, scope });
  return NextResponse.json(response, { status: 200 });
}

async function parseRequestBody(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return sessionRequestSchema.safeParse({});
  }

  try {
    const json = await request.json();
    return sessionRequestSchema.safeParse(json ?? {});
  } catch {
    return sessionRequestSchema.safeParse({});
  }
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function handleBearerToken(authHeader: string) {
  const token = authHeader.slice("bearer ".length).trim();
  if (!token) {
    return NextResponse.json({ error: "Session token is required" }, { status: 401 });
  }

  try {
    const payload = verifySessionToken(token);
    const response = sessionResponseSchema.parse({
      token,
      scope: payload.scope,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof TokenInvalidError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to validate session token" }, { status: 500 });
  }
}
