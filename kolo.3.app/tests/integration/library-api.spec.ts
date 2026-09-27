import { expect, test } from "@playwright/test";
import { createTestWav } from "../helpers/wav";

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
}

interface ApiLibrary {
  playlists: Array<{ id: string; name: string; count: number }>;
  tracks: ApiTrack[];
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
    const unsafe = await request.post("/api/youtube", {
      data: { playlistId: playlist.id, url: "https://example.com/song" },
    });
    expect(unsafe.ok()).toBe(false);
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

  test("validates Spotify import endpoints and returns status", async ({
    request,
  }) => {
    const statusBefore = await request.get("/api/spotify/status");
    expect(statusBefore.ok()).toBe(true);

    const invalid = await request.post("/api/spotify", {
      data: { url: "https://example.com/not-spotify" },
    });
    expect(invalid.ok()).toBe(false);

    const res = await request.post("/api/spotify", {
      data: {
        url: "https://open.spotify.com/playlist/37i9dQZEVXcOour5t7D6qU",
        createPlaylist: true,
      },
    });
    expect(res.status()).toBe(202);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBeTruthy();

    const statusAfter = await request.get("/api/spotify/status");
    expect(statusAfter.ok()).toBe(true);
    const statusData = (await statusAfter.json()) as {
      active: boolean;
      id?: string;
    };
    expect(statusData.active).toBe(true);
  });
});
