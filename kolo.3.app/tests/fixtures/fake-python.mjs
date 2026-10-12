#!/usr/bin/env node
// Stands in for the Python helpers during tests. It is started as
// "python <script> ...args" and speaks each script's JSON progress protocol,
// without the network, FFmpeg, or the embedding model.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { option, silentWav, sleep } from "./fake-common.mjs";

const [script, ...args] = process.argv.slice(2);
const emit = (event) => console.log(JSON.stringify(event));

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// A three-song collection called "Fake Mix". The third song cannot be found
// on the first attempt into a folder and is found on the next one, so a test
// can exercise the failure list and the retry.
async function importSpotify() {
  const root = process.env.KOLO_DATA_DIR;
  const url = option(args, "--url");
  if (url.includes("broken")) {
    emit({ type: "error", error: "Could not read that Spotify link." });
    process.exit(1);
  }

  let playlistId = option(args, "--playlist-id");
  let targetDir;
  if (playlistId === "imported") targetDir = join(root, "imported");
  else if (playlistId?.startsWith("custom:"))
    targetDir = join(root, "playlists", playlistId.slice(7));
  else {
    let slug = "fake-mix";
    while (existsSync(join(root, "playlists", slug)))
      slug = `fake-mix-${Math.random().toString(16).slice(2, 10)}`;
    targetDir = join(root, "playlists", slug);
    playlistId = `custom:${slug}`;
    const namesPath = join(root, ".kolo", "playlists.json");
    writeFileSync(
      namesPath,
      JSON.stringify({ ...readJson(namesPath, {}), [slug]: "Fake Mix" }),
    );
  }
  mkdirSync(targetDir, { recursive: true });

  const tracks = ["Fake Band - One", "Fake Band - Two", "Fake Band - Missing"];
  const present = new Set(readdirSync(targetDir));
  const pending = tracks.filter((track) => !present.has(`${track}.wav`));
  const existing = tracks.length - pending.length;
  const summary = {
    playlistName: "Fake Mix",
    playlistId,
    targetDir,
    total: tracks.length,
  };
  emit({
    type: "init",
    title: "Fake Mix",
    ...summary,
    alreadyPresent: existing,
    toDownload: pending.length,
  });

  const attempted = join(targetDir, ".missing-attempted");
  let downloaded = 0;
  let failed = 0;
  for (const track of pending) {
    emit({ type: "start", track });
    await sleep(850);
    const success = !track.endsWith("Missing") || existsSync(attempted);
    if (success) {
      writeFileSync(join(targetDir, `${track}.wav`), silentWav());
      downloaded += 1;
    } else {
      writeFileSync(attempted, "");
      failed += 1;
    }
    emit({
      type: "progress",
      current: downloaded + failed,
      total: pending.length,
      downloaded,
      failed,
      track,
      success,
      percent: ((downloaded + failed) / pending.length) * 100,
    });
  }
  emit({ type: "done", ...summary, downloaded, existing, failed });
}

// Gives every requested track four stars, except files named "Unreadable".
async function rateTracks() {
  const root = option(args, "--data-root");
  const ids = JSON.parse(readFileSync(0, "utf8"));
  const storePath = join(root, ".kolo", "ai_ratings.json");
  const scored = readJson(storePath, {}).ratings ?? {};
  const pending = ids.filter((id) => !scored[id]);
  const skipped = ids.length - pending.length;
  emit({ type: "init", total: pending.length, skipped, needEmbedding: 0 });

  let rated = 0;
  let failed = 0;
  for (const [index, trackId] of pending.entries()) {
    const track = basename(trackId).replace(/\.[^.]+$/, "");
    emit({ type: "start", track, trackId });
    if (index === 0) emit({ type: "stage", stage: "loading-encoder" });
    await sleep(index === 0 ? 1800 : 850);
    const success = !track.includes("Unreadable");
    if (success) {
      const store = readJson(storePath, { ratings: {} });
      store.ratings[trackId] = { rating: 4, vibeScore: 0.778 };
      writeFileSync(storePath, JSON.stringify(store));
      rated += 1;
    } else {
      failed += 1;
    }
    emit({
      type: "progress",
      current: index + 1,
      total: pending.length,
      track,
      trackId,
      success,
      rated,
      failed,
    });
  }
  emit({ type: "done", total: pending.length, rated, failed, skipped });
}

const helpers = {
  "download_playlist_latest.py": importSpotify,
  "rate_tracks.py": rateTracks,
  // Loudness is seeded by the fixture data; there is nothing to measure.
  "scan_loudness.py": async () => {},
};
await helpers[basename(script)]();
