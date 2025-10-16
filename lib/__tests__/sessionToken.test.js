/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

function importTypeScriptModule(relativePath) {
  const absolutePath = path.resolve(__dirname, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  });

  const moduleShim = { exports: {} };
  const context = vm.createContext({
    module: moduleShim,
    exports: moduleShim.exports,
    require,
    __dirname: path.dirname(absolutePath),
    __filename: absolutePath,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(outputText, context, { filename: absolutePath });
  return moduleShim.exports;
}

const {
  createSessionToken,
  verifySessionToken,
  TokenExpiredError,
} = importTypeScriptModule("../sessionToken.ts");

const SECRET = "test-secret";

test("creates a signed token with the expected expiry", () => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  const { token, scope, expiresAt } = createSessionToken({
    scope: "practice",
    ttlSeconds: 90,
    now,
    secret: SECRET,
  });

  assert.equal(scope, "practice");
  assert.equal(expiresAt, "2024-01-01T00:01:30.000Z");

  const payload = verifySessionToken(token, { now, secret: SECRET, requiredScope: "practice" });
  assert.equal(payload.scope, "practice");
  assert.equal(payload.exp, Math.floor(now.getTime() / 1000) + 90);
});

test("rejects expired tokens", () => {
  const now = new Date("2024-01-01T00:00:00.000Z");
  const { token } = createSessionToken({
    scope: "lecture",
    ttlSeconds: 1,
    now,
    secret: SECRET,
  });

  const future = new Date(now.getTime() + 2000);
  assert.throws(() => verifySessionToken(token, { now: future, secret: SECRET }), TokenExpiredError);
});
