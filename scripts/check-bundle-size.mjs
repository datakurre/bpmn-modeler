#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist/desktop");
const limits = {
  bpmn: 3_500_000,
  dmn: 3_500_000,
  form: 1_800_000,
  shell: 100_000,
};

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}

const failures = [];
for (const [name, limit] of Object.entries(limits)) {
  const directory = join(root, name);
  let size;
  try {
    size = await directorySize(directory);
  } catch {
    failures.push(`${name}: output directory is missing (${directory})`);
    continue;
  }

  const megabytes = (size / 1_000_000).toFixed(2);
  const limitMegabytes = (limit / 1_000_000).toFixed(2);
  console.log(`${name}: ${megabytes} MB / ${limitMegabytes} MB`);
  if (size > limit) {
    failures.push(`${name}: ${megabytes} MB exceeds the ${limitMegabytes} MB limit`);
  }
}

if (failures.length > 0) {
  console.error("Bundle-size check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
