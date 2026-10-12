#!/usr/bin/env node
// Stands in for yt-dlp during tests. It prints the lines the download job
// reads and writes a small audio file, without using the network.
//
// The video ID steers the outcome: one containing "fail" is unavailable, and
// one containing "slow" takes a few seconds so a test can watch or cancel it.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { silentWav, sleep } from "./fake-common.mjs";

const args = process.argv.slice(2);
const paths = Object.fromEntries(
  args
    .filter((value, index) => args[index - 1] === "-P")
    .map((value) => value.split(/:(.*)/s).slice(0, 2)),
);
const url = new URL(args.at(-1));
const id = url.searchParams.get("v") ?? url.pathname.split("/").at(-1);

if (id.includes("fail")) {
  console.error(`ERROR: [youtube] ${id}: Video unavailable`);
  process.exit(1);
}

const steps = id.includes("slow") ? 20 : 4;
const size = 4_000_000;
const partial = join(paths.temp, `${id}.webm.part`);
mkdirSync(paths.temp, { recursive: true });

console.log(`KOLO_TITLE Fake Artist - ${id}`);
for (let step = 1; step <= steps; step += 1) {
  writeFileSync(partial, "partial download");
  console.log(`KOLO_PROGRESS ${Math.round((size * step) / steps)} ${size} NA`);
  await sleep(150);
}
console.log(`KOLO_CONVERT ${id}`);
await sleep(150);
rmSync(partial);

const saved = join(paths.home, `Fake_Artist_-_${id}.wav`);
writeFileSync(saved, silentWav());
console.log(`KOLO_FILE ${saved}`);
