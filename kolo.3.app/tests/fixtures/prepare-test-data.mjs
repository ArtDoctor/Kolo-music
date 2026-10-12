import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.env.KOLO_DATA_DIR ?? ".playwright-data");
rmSync(root, { recursive: true, force: true });

for (const folder of [
  "pos",
  "downloads/OLD",
  "discovery",
  "imported",
  "neg",
  ".kolo",
]) {
  mkdirSync(join(root, folder), { recursive: true });
}

function wav(frequency = 440, durationSeconds = 4) {
  const sampleRate = 16_000;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 500, (samples - index) / 500);
    buffer.writeInt16LE(
      Math.round(
        Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 5000 * fade,
      ),
      44 + index * 2,
    );
  }
  return buffer;
}

const fixtures = [
  ["pos/Aurora - Neon Sky.wav", 440],
  ["pos/Mira - Quiet Motion.wav", 523],
  ["downloads/OLD/Archive Artist - Old Light.wav", 330],
  ["discovery/Nova - New Signal.wav", 659],
  ["neg/Noise Unit - Static Test.wav", 220],
];

for (const [relativePath, frequency] of fixtures) {
  writeFileSync(join(root, relativePath), wav(frequency));
}

writeFileSync(
  join(root, ".kolo/ai_ratings.json"),
  JSON.stringify(
    {
      version: "test",
      ratings: {
        "pos/Aurora - Neon Sky.wav": { rating: 4.25, vibeScore: 0.833 },
      },
    },
    null,
    2,
  ),
);

// One quiet and one loud track, with the gains scan_loudness.py derives for
// a -14 LUFS target.
writeFileSync(
  join(root, ".kolo/loudness.json"),
  JSON.stringify(
    {
      "pos/Aurora - Neon Sky.wav": { lufs: -20, gain: 1.995 },
      "pos/Mira - Quiet Motion.wav": { lufs: -8, gain: 0.501 },
    },
    null,
    2,
  ),
);

console.log(`Prepared Playwright music library at ${root}`);
