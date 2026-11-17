#!/usr/bin/env node
/**
 * build-css.mjs — copies the layout sheet into the client bundle.
 *
 * The plugin loader serves one module per client and does not hand out other
 * files from the package, so the sheet ships inside `lib/client.js`. This script
 * keeps that copy identical to `lib/layout.css`, the file a stylesheet linter
 * and an editor can read.
 *
 *   node scripts/build-css.mjs           rewrite the bundle
 *   node scripts/build-css.mjs --check   fail when the copy is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const CSS_FILE = join(ROOT, "lib", "layout.css");
const CLIENT_FILE = join(ROOT, "lib", "client.js");
const START = "/* build-css:start */";
const END = "/* build-css:end */";

const css = readFileSync(CSS_FILE, "utf8").trimEnd();
// The sheet lives in a template literal: a backtick or an interpolation would
// end it early, and the browser would run a broken bundle.
for (const [needle, why] of [
  ["`", "backtick"],
  ["${", "interpolation"],
]) {
  if (css.includes(needle)) {
    console.error(`lib/layout.css contains a ${why}, which cannot sit inside the bundle template literal`);
    process.exit(1);
  }
}

const source = readFileSync(CLIENT_FILE, "utf8");
const start = source.indexOf(START);
const end = source.indexOf(END);
if (start < 0 || end <= start) {
  console.error("lib/client.js lost its build-css markers");
  process.exit(1);
}

const cut = start + START.length;
const next = `${source.slice(0, cut)}\n${css}\n${source.slice(end)}`;

if (next === source) {
  console.log("layout sheet in sync");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  console.error("lib/client.js is stale: run `npm run build-css`");
  process.exit(1);
}
writeFileSync(CLIENT_FILE, next);
console.log("layout sheet copied into lib/client.js");
