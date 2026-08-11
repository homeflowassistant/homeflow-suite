// ESM loader hook: redirects every import of server/ghl-service to
// a mock module that stubs out the database- and GHL-API-calling
// functions, plus the fetch-based S&G worker / client search calls.
import type { ResolveHook, LoadHook } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import esbuild from "esbuild";

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
  if (specifier.endsWith("/ghl-service") || specifier.includes("ghl-service.")) {
    // Only mock the local package module, not the test file itself.
    if (context.parentURL?.includes("mock-ghl-service-loader")) {
      return nextResolve(specifier, context);
    }
    return {
      format: "module",
      shortCircuit: true,
      url: pathToFileURL(path.join(import.meta.dirname ?? process.cwd(), "mock-ghl-service.ts")).href,
    };
  }
  return nextResolve(specifier, context);
};

export const load: LoadHook = (url, context, nextLoad) => {
  if (url.endsWith("mock-ghl-service.ts") && url.startsWith("file://")) {
    try {
      const raw = readFileSync(new URL(url), "utf8");
      const { code } = esbuild.transformSync(raw, { loader: "ts", format: "esm", target: "node22" });
      return { format: "module", source: code, shortCircuit: true };
    } catch {
      return nextLoad(url, context);
    }
  }
  return nextLoad(url, context);
};
