import { expect, test, type APIRequestContext } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createTestWav } from "../helpers/wav";
import type { Job } from "../../src/types";

const dataRoot = resolve(import.meta.dirname, "../../.playwright-data");

interface ApiTrack {
  id: string;
  title: string;
  artist: string;
  playlistId: string;
  rating: number | null;
  aiRating: number | null;
  vibeScore: number | null;
  liked: boolean;
  audioUrl: string;
  gain: number;
  lufs: number | null;
}

interface ApiLibrary {
  playlists: Array<{ id: string; name: string; count: number }>;
  tracks: ApiTrack[];
}

async function loadLibrary(request: APIRequestContext) {
  return (await (await request.get("/api/library")).json()) as ApiLibrary;
}

async function loadJobs(request: APIRequestContext) {
  const body = (await (await request.get("/api/jobs")).json()) as {
    jobs: Job[];
  };
  return body.jobs;
}

async function startDownload(request: APIRequestContext, data: object) {
  const response = await request.post("/api/jobs/download", { data });
  expect(response.status()).toBe(202);
  return (await response.json()) as Job;
}

// Resolves to the job once it is no longer queued or running.
async function finished(request: APIRequestContext, id: string) {
  let job: Job | undefined;
  await expect
    .poll(async () => {
      job = (await loadJobs(request)).find((item) => item.id === id);
      return job?.status;
    })
    .toMatch(/^(done|error|cancelled)$/);
  return job!;
}

test.describe("local library integration", () => {
  test.describe.configure({ mode: "serial" });

  test("scans each data folder into the expected playlists", async ({
    request,
  }) => {
    const response = await request.get("/api/library");
    expect(response.ok()).toBeTruthy();
    const library = (await response.json()) as ApiLibrary;

    expect(
      library.playlists.slice(0, 6).map((playlist) => playlist.id),
    ).toEqual(["liked", "pos", "old", "discovery", "imported", "negative"]);
    expect(
      library.playlists.find((playlist) => playlist.id === "pos")?.count,
    ).toBe(2);
    expect(
      library.playlists.find((playlist) => playlist.id === "old")?.count,
    ).toBe(1);
    expect(
      library.playlists.find((playlist) => playlist.id === "discovery")?.count,
    ).toBe(1);
    expect(
      library.playlists.find((playlist) => playlist.id === "negative")?.count,
    ).toBe(1);

    expect(
      library.tracks.filter((track) =>
        ["pos", "old", "discovery", "negative"].includes(track.playlistId),
      ),
    ).toHaveLength(5);
    expect(library.tracks[0]).toMatchObject({
      artist: "Aurora",
      title: "Neon Sky",
      playlistId: "pos",
      aiRating: 4.25,
      vibeScore: 0.833,
    });
  });

  test("exposes loudness gains that boost quiet tracks and cut loud ones", async ({
    request,
  }) => {
    const library = (await (
      await request.get("/api/library")
    ).json()) as ApiLibrary;
    const byId = new Map(library.tracks.map((track) => [track.id, track]));

    expect(byId.get("pos/Aurora - Neon Sky.wav")).toMatchObject({
      lufs: -20,
      gain: 1.995,
    });
    expect(byId.get("pos/Mira - Quiet Motion.wav")).toMatchObject({
      lufs: -8,
      gain: 0.501,
    });
  });

  test("streams playable audio with byte-range seeking", async ({
    request,
  }) => {
    const library = await request
      .get("/api/library")
      .then((response) => response.json() as Promise<ApiLibrary>);
    const response = await request.get(library.tracks[0].audioUrl, {
      headers: { Range: "bytes=0-1023" },
    });

    expect(response.status()).toBe(206);
    expect(response.headers()["accept-ranges"]).toBe("bytes");
    expect(response.headers()["content-range"]).toContain("bytes 0-1023/");
    expect(response.headers()["content-type"]).toContain("audio/wav");
    expect((await response.body()).byteLength).toBe(1024);
  });

  test("persists ratings and likes independently", async ({ request }) => {
    const initial = await request
      .get("/api/library")
      .then((response) => response.json() as Promise<ApiLibrary>);
    const track = initial.tracks[0];

    const save = await request.post("/api/ratings", {
      data: { trackId: track.id, rating: 4.5 },
    });
    expect(save.status()).toBe(204);

    const rated = await request
      .get("/api/library")
      .then((response) => response.json() as Promise<ApiLibrary>);
    expect(rated.tracks.find((item) => item.id === track.id)?.rating).toBe(4.5);
    expect(
      rated.playlists.find((playlist) => playlist.id === "liked")?.count,
    ).toBe(0);
    expect(
      (
        await request.post("/api/likes", {
          data: { trackId: track.id, liked: true },
        })
      ).status(),
    ).toBe(204);
    const liked = await request
      .get("/api/library")
      .then((response) => response.json() as Promise<ApiLibrary>);
    expect(liked.tracks.find((item) => item.id === track.id)?.liked).toBe(true);
    expect(
      liked.playlists.find((playlist) => playlist.id === "liked")?.count,
    ).toBe(1);

    const clear = await request.post("/api/ratings", {
      data: { trackId: track.id, rating: null },
    });
    expect(clear.status()).toBe(204);
    const restored = await request
      .get("/api/library")
      .then((response) => response.json() as Promise<ApiLibrary>);
    expect(
      restored.tracks.find((item) => item.id === track.id)?.rating,
    ).toBeNull();
    expect(restored.tracks.find((item) => item.id === track.id)?.liked).toBe(
      true,
    );
    await request.post("/api/likes", {
      data: { trackId: track.id, liked: false },
    });
  });

  test("creates a playlist and imports audio into that playlist", async ({
    request,
  }) => {
    const response = await request.post("/api/playlists", {
      data: { name: "Night Drive" },
    });
    expect(response.ok()).toBeTruthy();
    const playlist = (await response.json()) as { id: string; name: string };
    expect(playlist.id).toMatch(/^custom:/);
    expect(playlist.name).toBe("Night Drive");
    const upload = await request.post(
      `/api/import?name=${encodeURIComponent("Test Artist - Midnight.wav")}&playlistId=${encodeURIComponent(playlist.id)}`,
      { data: createTestWav() },
    );
    expect(upload.ok()).toBeTruthy();
    const library = await request
      .get("/api/library")
      .then((result) => result.json() as Promise<ApiLibrary>);
    expect(library.playlists).toContainEqual(
      expect.objectContaining({
        id: playlist.id,
        name: "Night Drive",
        count: 1,
      }),
    );
    expect(library.tracks).toContainEqual(
      expect.objectContaining({ title: "Midnight", playlistId: playlist.id }),
    );
    const invalid = await request.post(
      "/api/import?name=song.wav&playlistId=../../pos",
      { data: createTestWav() },
    );
    expect(invalid.ok()).toBe(false);
  });

  test("copies uploaded audio into the Imported playlist", async ({
    request,
  }, testInfo) => {
    const before = await request
      .get("/api/library")
      .then((result) => result.json() as Promise<ApiLibrary>);
    const previousCount =
      before.playlists.find((playlist) => playlist.id === "imported")?.count ??
      0;
    const title = `Imported Song ${testInfo.retry}`;
    const response = await request.post(
      `/api/import?name=${encodeURIComponent(`Test Artist - ${title}.wav`)}`,
      {
        data: createTestWav(),
        headers: { "Content-Type": "audio/wav" },
      },
    );
    expect(response.ok()).toBeTruthy();

    const library = await request
      .get("/api/library")
      .then((result) => result.json() as Promise<ApiLibrary>);
    expect(
      library.playlists.find((playlist) => playlist.id === "imported")?.count,
    ).toBe(previousCount + 1);
    expect(library.tracks).toContainEqual(
      expect.objectContaining({
        title,
        artist: "Test Artist",
        playlistId: "imported",
      }),
    );
  });

  test("runs downloads side by side, queues the overflow, and cancels on request", async ({
    request,
  }) => {
    const jobs: Job[] = [];
    for (const id of ["slow-a", "slow-b", "slow-c", "slow-d"]) {
      jobs.push(
        await startDownload(request, {
          url: `https://www.youtube.com/watch?v=${id}`,
          playlistId: "imported",
        }),
      );
    }
    const [first, second, third, fourth] = jobs;

    // Three run at once; the fourth waits for a slot.
    await expect
      .poll(async () =>
        (await loadJobs(request)).map((job) => job.status).join(),
      )
      .toBe("running,running,running,queued");

    // Asking for a link that is already downloading returns the same job.
    const repeat = await startDownload(request, {
      url: "https://www.youtube.com/watch?v=slow-a",
      playlistId: "imported",
    });
    expect(repeat.id).toBe(first.id);

    await expect
      .poll(async () => {
        const job = (await loadJobs(request)).find(
          (item) => item.id === first.id,
        )!;
        return job.percent !== null && job.percent > 0 && job.percent < 100
          ? `${job.title} | ${job.playlistName}`
          : "";
      })
      .toBe("Fake Artist - slow-a | Imports");

    // Files that are still downloading are not part of the library.
    expect(
      (await loadLibrary(request)).tracks.filter((track) =>
        ["slow-a", "slow-b", "slow-c", "slow-d"].includes(track.title),
      ),
    ).toEqual([]);

    for (const job of [second, fourth]) {
      const response = await request.post(`/api/jobs/${job.id}/cancel`);
      expect(((await response.json()) as Job).status).toBe("cancelled");
    }

    expect(await finished(request, first.id)).toMatchObject({
      status: "done",
      completed: 1,
      percent: 100,
      detail: "Added to Imports",
      retryable: false,
    });
    expect((await finished(request, third.id)).status).toBe("done");
    expect(await finished(request, second.id)).toMatchObject({
      status: "cancelled",
      retryable: true,
    });

    const titles = (await loadLibrary(request)).tracks
      .filter((track) => track.playlistId === "imported")
      .map((track) => track.title);
    expect(titles).toEqual(expect.arrayContaining(["slow-a", "slow-c"]));
    expect(titles).not.toContain("slow-b");
    expect(titles).not.toContain("slow-d");

    // Nothing is left behind in the staging area, cancelled or not.
    const staging = resolve(dataRoot, ".kolo/tmp");
    await expect
      .poll(() => (existsSync(staging) ? readdirSync(staging) : []))
      .toEqual([]);

    expect((await request.post("/api/jobs/clear")).status()).toBe(204);
    expect(await loadJobs(request)).toEqual([]);
  });

  test("reports why a download failed and refuses unsupported links", async ({
    request,
  }) => {
    const failing = await startDownload(request, {
      url: "https://www.youtube.com/watch?v=fail-1",
      playlistId: "imported",
    });
    expect(await finished(request, failing.id)).toMatchObject({
      status: "error",
      error: "[youtube] fail-1: Video unavailable",
      retryable: true,
    });
    expect(
      (await request.post(`/api/jobs/${failing.id}/dismiss`)).status(),
    ).toBe(204);
    expect(await loadJobs(request)).toEqual([]);

    for (const data of [
      { url: "https://example.com/song", playlistId: "imported" },
      { url: "http://www.youtube.com/watch?v=abc", playlistId: "imported" },
      { url: "https://www.youtube.com/watch?v=abc", playlistId: "../pos" },
    ]) {
      expect((await request.post("/api/jobs/download", { data })).ok()).toBe(
        false,
      );
    }
    expect(await loadJobs(request)).toEqual([]);
  });

  test("imports a Spotify collection, lists what was not found, and retries it", async ({
    request,
  }) => {
    const started = await startDownload(request, {
      url: "https://open.spotify.com/album/integration",
      createPlaylist: true,
    });
    const job = await finished(request, started.id);
    expect(job).toMatchObject({
      kind: "spotify",
      status: "done",
      title: "Fake Mix",
      playlistName: "Fake Mix",
      completed: 2,
      failed: 1,
      failures: ["Fake Band - Missing"],
      detail: "Added 2 songs · 1 not found",
      retryable: true,
    });
    expect(job.playlistId).toMatch(/^custom:fake-mix/);
    expect((await loadLibrary(request)).playlists).toContainEqual({
      id: job.playlistId,
      name: "Fake Mix",
      count: 2,
    });

    // The retry goes into the playlist the first attempt created.
    const retry = await request.post(`/api/jobs/${job.id}/retry`);
    expect(retry.status()).toBe(202);
    const retried = await finished(request, ((await retry.json()) as Job).id);
    expect(retried).toMatchObject({
      status: "done",
      playlistId: job.playlistId,
      completed: 1,
      skipped: 2,
      failed: 0,
      detail: "Added 1 song · 2 already there",
      retryable: false,
    });
    expect((await loadLibrary(request)).playlists).toContainEqual({
      id: job.playlistId,
      name: "Fake Mix",
      count: 3,
    });
    expect((await loadJobs(request)).map((item) => item.id)).toEqual([
      retried.id,
    ]);

    const broken = await startDownload(request, {
      url: "https://open.spotify.com/playlist/broken",
    });
    expect(await finished(request, broken.id)).toMatchObject({
      status: "error",
      error: "Could not read that Spotify link.",
    });
    await request.post("/api/jobs/clear");
  });

  test("rates the requested tracks that have no estimate yet", async ({
    request,
  }) => {
    const unrated = "discovery/Nova - New Signal.wav";
    const alreadyRated = "pos/Aurora - Neon Sky.wav";
    const response = await request.post("/api/jobs/rating", {
      data: {
        trackIds: [unrated, alreadyRated, "../outside.wav", ".kolo/likes.json"],
        playlistId: "discovery",
        playlistName: "Discovery",
      },
    });
    expect(response.status()).toBe(202);
    const job = await finished(request, ((await response.json()) as Job).id);
    expect(job).toMatchObject({
      kind: "rating",
      status: "done",
      playlistId: "discovery",
      total: 1,
      completed: 1,
      skipped: 1,
      failed: 0,
      detail: "Rated 1 song",
    });

    const byId = new Map(
      (await loadLibrary(request)).tracks.map((track) => [track.id, track]),
    );
    expect(byId.get(unrated)).toMatchObject({ aiRating: 4, vibeScore: 0.778 });
    expect(byId.get(alreadyRated)?.aiRating).toBe(4.25);

    const nothing = await request.post("/api/jobs/rating", {
      data: { trackIds: ["../outside.wav"] },
    });
    expect(nothing.ok()).toBe(false);
    await request.post("/api/jobs/clear");
  });
});
