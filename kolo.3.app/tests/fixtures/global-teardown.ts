import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export default async function globalTeardown() {
  const root = resolve(process.env.KOLO_DATA_DIR ?? ".playwright-data");
  await rm(root, { recursive: true, force: true });
}
