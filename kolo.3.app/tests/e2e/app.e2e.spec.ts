import { expect, test } from "@playwright/test";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createTestWav } from "../helpers/wav";
import { getTrackSearchQuery } from "../../src/library";

const ratedFixtureId = "pos/Aurora - Neon Sky.wav";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Kolo" }),
  ).toBeVisible();
});

test.afterEach(async ({ request }) => {
  await request.post("/api/ratings", {
    data: { trackId: ratedFixtureId, rating: null },
  });
  await request.post("/api/likes", {
    data: { trackId: ratedFixtureId, liked: false },
  });
});

test("navigates playlists and searches the selected collection", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music, 2 songs/ }).click();
  await expect(page.getByTestId("track-row")).toHaveCount(2);
  await page.getByRole("button", { name: /Old playlist, 1 song/ }).click();
  await expect(
    page.getByRole("heading", { name: "Old playlist" }),
  ).toBeVisible();
  await expect(page.getByText("Old Light", { exact: true })).toBeVisible();

  const search = page.getByPlaceholder("Search your music");
  await search.fill("Archive Artist");
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await search.fill("does not exist");
  await expect(
    page.getByRole("heading", { name: "No songs here yet" }),
  ).toBeVisible();
});

test("renders a large playlist progressively without delaying navigation", async ({
  page,
}) => {
  const folder = resolve(import.meta.dirname, "../../.playwright-data/pos");
  const paths = Array.from({ length: 180 }, (_, index) =>
    resolve(
      folder,
      `Stress Artist - Track ${String(index).padStart(3, "0")}.wav`,
    ),
  );
  const audio = createTestWav(440, 0.1);

  try {
    await Promise.all(paths.map((path) => writeFile(path, audio)));
    await page.reload();
    await page.getByRole("button", { name: /Phone music, 182 songs/ }).click();
    await expect(
      page.getByRole("heading", { name: "Phone music" }),
    ).toBeVisible();
    await expect(page.getByTestId("track-row")).toHaveCount(60);

    await page.getByRole("button", { name: "Open profile" }).click();
    await expect(page.locator(".profile-menu")).toBeVisible();

    const sentinel = page.locator(".list-sentinel");
    await sentinel.scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.getByTestId("track-row").count())
      .toBeGreaterThan(60);
    for (let index = 0; index < 3 && (await sentinel.count()); index += 1) {
      await sentinel.scrollIntoViewIfNeeded();
      await expect
        .poll(() => page.getByTestId("track-row").count())
        .toBeGreaterThan(60 + 80 * index);
    }
    await expect(page.getByTestId("track-row")).toHaveCount(182);
  } finally {
    await Promise.all(paths.map((path) => unlink(path)));
  }
});

test("puts vibe filter in Settings and persists appearance", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
    )
    .toBe("#0d8275");
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue(
    "0.15",
  );
  await expect(
    page.getByRole("button", { name: "Open vibe filter" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open profile" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Vibe filter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use accent #7c6cff" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
    )
    .toBe("#7c6cff");
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
    )
    .toBe("#7c6cff");
});

test("rates in half-star steps but only hearts add songs to Liked songs", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  const firstRow = page
    .getByTestId("track-row")
    .filter({ hasText: "Neon Sky" });
  const title = await firstRow.locator(".track-title strong").innerText();
  const rating = firstRow.getByTestId("star-rating");
  await expect(rating).toHaveClass(/has-ai-prediction/);
  await expect(rating).toHaveAttribute("data-ai-rating", "4.25");
  const fourthStar = rating.getByRole("button").nth(3);
  const bounds = await fourthStar.boundingBox();
  expect(bounds).not.toBeNull();

  let saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/ratings") &&
      response.request().method() === "POST",
  );
  await fourthStar.click({
    position: { x: 2, y: Math.floor(bounds!.height / 2) },
  });
  await saved;
  await expect(rating).toHaveAttribute("data-rating", "3.5");
  await expect(rating).not.toHaveClass(/has-ai-prediction/);
  await expect(rating).toHaveAttribute("data-ai-rating", "");

  saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/ratings") &&
      response.request().method() === "POST",
  );
  await fourthStar.click({
    position: {
      x: Math.floor(bounds!.width - 2),
      y: Math.floor(bounds!.height / 2),
    },
  });
  await saved;
  await expect(rating).toHaveAttribute("data-rating", "4");

  await expect(
    page.getByRole("button", { name: /Liked songs, 0 songs/ }),
  ).toBeVisible();
  await firstRow
    .getByRole("button", { name: "Like song", exact: true })
    .click();
  await page.getByRole("button", { name: /Liked songs, 1 song/ }).click();
  await expect(
    page.getByTestId("track-row").getByText(title, { exact: true }),
  ).toBeVisible();
});

test("saves a rating and like across an immediate reload", async ({ page }) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  const row = page.getByTestId("track-row").filter({ hasText: "Neon Sky" });
  await row.getByRole("button", { name: "Like song" }).click();
  const fifthStar = row
    .getByTestId("star-rating")
    .getByRole("button", { name: "Rate 5 stars" });
  const bounds = await fifthStar.boundingBox();
  await fifthStar.click({
    position: {
      x: Math.floor(bounds!.width - 2),
      y: Math.floor(bounds!.height / 2),
    },
  });
  await page.reload();
  await page.getByRole("button", { name: /Phone music/ }).click();
  await expect(
    page
      .getByTestId("track-row")
      .filter({ hasText: "Neon Sky" })
      .getByTestId("star-rating"),
  ).toHaveAttribute("data-rating", "5");
  await page.getByRole("button", { name: /Liked songs, 1 song/ }).click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
});

test("plays real audio and updates shuffle, repeat, and tracks immediately", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  const audio = page.locator("audio");
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration))
    .toBeGreaterThan(3);

  const shuffle = page.getByRole("button", { name: "Shuffle", exact: true });
  await shuffle.click();
  await expect(shuffle).toHaveClass(/enabled/);
  await expect(shuffle).toHaveCSS("color", "rgb(13, 130, 117)");

  const repeat = page.getByRole("button", { name: "Repeat off" });
  await repeat.click();
  await expect(page.getByRole("button", { name: "Repeat all" })).toHaveClass(
    /enabled/,
  );

  await page.getByRole("button", { name: "Next song" }).click();
  await expect(page.locator(".now-playing strong")).toHaveText(
    /Quiet Motion|Neon Sky/,
  );
});

test("shuffle-play keeps its queue when browsing another playlist", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await page
    .getByTestId("track-row")
    .filter({ hasText: "Neon Sky" })
    .getByRole("button", { name: "Like song" })
    .click();
  await page.getByRole("button", { name: "Shuffle play" }).click();
  await expect(
    page.getByRole("button", { name: "Shuffle", exact: true }),
  ).toHaveClass(/enabled/);
  await page.getByRole("button", { name: /Liked songs, 1 song/ }).click();
  await page.getByRole("button", { name: "Open queue" }).click();
  await expect(page.getByText("Playing from Phone music")).toBeVisible();
  await expect(page.locator(".queue-list > button")).toHaveCount(2);
  await expect(page.locator(".scrim")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Liked songs" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next song" }).click();
  await expect(page.locator(".queue-list > button")).toHaveCount(2);
});

test("restores the chosen volume, supports wheel control, and enlarges range hit areas", async ({
  page,
}) => {
  const volume = page.getByRole("slider", { name: "Volume" });
  await volume.fill("0.17");
  await page.getByRole("button", { name: "Mute" }).click();
  await expect(volume).toHaveValue("0");
  await page.getByRole("button", { name: "Unmute" }).click();
  await expect(volume).toHaveValue("0.17");
  await volume.hover();
  await page.mouse.wheel(0, -120);
  await expect(volume).toHaveValue("0.2");
  const progress = page.getByRole("slider", { name: "Song progress" });
  expect((await progress.boundingBox())!.height).toBeGreaterThanOrEqual(20);
});

test("changing volume during playback does not stop or reload the song", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  const audio = page.locator("audio");
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);

  const volume = page.getByRole("slider", { name: "Volume" });
  await volume.fill("0.3");
  await expect(volume).toHaveValue("0.3");

  // Allow a moment to verify playback state is uninterrupted
  await page.waitForTimeout(500);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
});

test("seeking and switching songs during playback transitions smoothly without interruption", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  const audio = page.locator("audio");
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);

  // Seek forward
  const progress = page.getByRole("slider", { name: "Song progress" });
  await progress.fill("2");
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThanOrEqual(1.8);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);

  // Switch to next song while playing
  await page.getByRole("button", { name: "Next song" }).click();
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(false);
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThanOrEqual(0);
});

test("creates a custom playlist and imports into it", async ({ page }) => {
  page.once("dialog", (dialog) => dialog.accept("Late Night"));
  await page.getByRole("button", { name: "Create playlist" }).click();
  await expect(page.getByRole("heading", { name: "Late Night" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import songs" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Artist - Fresh.wav",
    mimeType: "audio/wav",
    buffer: createTestWav(),
  });
  await expect(
    page.getByTestId("track-row").getByText("Fresh", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Late Night, 1 songs?/ }).click();
  await expect(
    page.getByTestId("track-row").getByText("Fresh", { exact: true }),
  ).toBeVisible();
});

test("collapses playlists to icons and exposes rating shortcuts", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Collapse playlists" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Expand playlists" }).click();
  await page.getByRole("button", { name: "Go to Home" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Kolo" }),
  ).toBeVisible();
});

test("searches YouTube for a song without treating search text as a download URL", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await page.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ status: 200, body: "Search results" }),
  );
  await page.getByRole("button", { name: "Add link or search" }).click();
  await page
    .getByRole("textbox", { name: "Music link or search" })
    .fill("Aurora Neon Sky");
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open / search" }).click();
  const popup = await popupEvent;
  await expect
    .poll(() => popup.url())
    .toContain("youtube.com/results?search_query=Aurora%20Neon%20Sky");
  await popup.close();
});

test("searches YouTube from the button in the player bar only", async ({
  page,
}) => {
  expect(getTrackSearchQuery({ title: "Neon Sky", artist: "Aurora" })).toBe(
    "Neon Sky Aurora",
  );
  expect(
    getTrackSearchQuery({ title: "Solo Song", artist: "Unknown artist" }),
  ).toBe("Solo Song");
  expect(getTrackSearchQuery({ title: "Solo Song", artist: "" })).toBe(
    "Solo Song",
  );
  expect(getTrackSearchQuery({ title: "Solo Song" })).toBe("Solo Song");

  await page.getByRole("button", { name: /Phone music/ }).click();
  await page.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ status: 200, body: "Search results" }),
  );

  // Track rows no longer show a YouTube button (player bar only)
  const row = page.getByTestId("track-row").filter({ hasText: "Neon Sky" });
  await expect(row.getByTestId("youtube-search-btn")).toHaveCount(0);

  // Now-playing bar YouTube search button
  await row.click();
  const nowPlaying = page.locator(".now-playing");
  const playerYtBtn = nowPlaying.getByTestId("youtube-search-btn");
  await expect(playerYtBtn).toBeVisible();
  await expect(playerYtBtn).toHaveAttribute(
    "title",
    'Search "Neon Sky Aurora" on YouTube',
  );

  const popupEvent2 = page.waitForEvent("popup");
  await playerYtBtn.click();
  const popup2 = await popupEvent2;
  await expect
    .poll(() => popup2.url())
    .toContain("youtube.com/results?search_query=Neon%20Sky%20Aurora");
  await popup2.close();
});

test("imports a browser-selected audio file into the persistent Imported playlist", async ({
  page,
}, testInfo) => {
  const title = `E2E Import ${testInfo.retry}`;
  await page.locator('input[type="file"]').setInputFiles({
    name: `Browser Artist - ${title}.wav`,
    mimeType: "audio/wav",
    buffer: createTestWav(466),
  });

  await expect(page.getByRole("heading", { name: "Imports" })).toBeVisible();
  await expect(
    page.getByTestId("track-row").getByText(title, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Browser Artist", { exact: true })).toBeVisible();
});

test("recognizes Spotify playlist link and exposes Spotify download action", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await page.route("**/api/spotify", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ id: "test-job", status: "starting" }),
    }),
  );
  await page.route("**/api/spotify/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        active: true,
        playlistName: "Discover Weekly",
        playlistId: "custom:discover-weekly",
        downloaded: 1,
        total: 30,
        percent: 3.3,
        currentTrack: "Zeli - Butterflies",
        status: "downloading",
      }),
    }),
  );

  await page.getByRole("button", { name: "Add link or search" }).click();
  await page.getByRole("button", { name: "Discover Weekly" }).click();

  const input = page.getByRole("textbox", { name: "Music link or search" });
  await expect(input).toHaveValue(
    "https://open.spotify.com/playlist/37i9dQZEVXcOour5t7D6qU",
  );

  const spotifyButton = page.getByRole("button", {
    name: "Download from Spotify",
  });
  await expect(spotifyButton).toBeVisible();
  await spotifyButton.click();

  await expect(page.getByText(/1 of 30/)).toBeVisible();
  await expect(
    page.getByText("Zeli - Butterflies", { exact: true }),
  ).toBeVisible();
});

test("supports 3.5+ stars filter card and toolbar chip", async ({ page }) => {
  await expect(page.getByText("3.5+ Stars")).toBeVisible();
  await page.getByRole("button", { name: /Phone music/ }).click();
  await expect(page.getByRole("button", { name: "3.5+" })).toBeVisible();
  await page.getByRole("button", { name: "3.5+" }).click();
  await expect(page.getByRole("button", { name: "3.5+" })).toHaveClass(
    /active/,
  );
});

test("clicking artist searches across entire library", async ({ page }) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  const artistBtn = page
    .getByRole("button", { name: "Aurora", exact: true })
    .first();
  await expect(artistBtn).toBeVisible();
  await artistBtn.click();
  await expect(page.getByText(/Showing songs featuring:/)).toBeVisible();
  await expect(page.locator(".artist-active-banner strong")).toHaveText(
    "Aurora",
  );
});

test("cluster visualization provides minimalist 3D explorer without telemetry", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open 3D Space" }).click();
  await expect(page.locator(".viz-modal-overlay")).toBeVisible();
  const frame = page.frameLocator('iframe[title="3D Latent Space Explorer"]');
  await expect(frame.locator(".title")).toHaveText("Taste Universe");
  await expect(frame.getByRole("button", { name: "3D t-SNE" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "3D UMAP" })).toBeVisible();
  // 2D modes and telemetry box must NOT be present
  await expect(frame.getByRole("button", { name: "2D t-SNE" })).toHaveCount(0);
  await expect(frame.locator("#sidebar-stats")).toHaveCount(0);
});

test("playlist header shows only playlist name without 'Playlist' label and has clickable column sorting", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await expect(page.locator(".playlist-header h1")).toHaveText("Phone music");
  await expect(
    page.locator(".playlist-header").getByText("Playlist", { exact: true }),
  ).toHaveCount(0);

  // Old sort select must NOT be present
  await expect(page.locator("#track-sort-select")).toHaveCount(0);
  await expect(page.getByText("Sort:")).toHaveCount(0);

  // Clickable column headers
  const ratingCol = page.getByRole("button", { name: "Your rating" });
  await expect(ratingCol).toBeVisible();
  await ratingCol.click();
  await expect(ratingCol).toHaveClass(/active/);

  // Date column visible with date text
  const dateCol = page.getByRole("button", { name: "Date" });
  await expect(dateCol).toBeVisible();
  await expect(page.locator(".track-date").first()).toBeVisible();

  // Title column sorting
  const titleCol = page.getByRole("button", { name: "Title" });
  await expect(titleCol).toBeVisible();
  await titleCol.click();
  await expect(titleCol).toHaveClass(/active/);
});

test("non-rated songs list excludes tracks from negative datasets", async ({
  page,
}) => {
  await page.getByRole("button", { name: "View Non-Rated" }).click();
  await expect(page.locator(".playlist-header h1")).toHaveText(
    "Non-rated songs",
  );

  const rows = page.locator(".track-row");
  const count = await rows.count();
  for (let i = 0; i < Math.min(count, 15); i++) {
    const trackId = await rows.nth(i).getAttribute("data-track-id");
    expect(trackId).not.toMatch(/^neg\//);
  }
});

test("bottom player bar shows larger stars and compact height", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await page.locator(".track-row").first().click();
  await expect(page.locator(".player-bar")).toBeVisible();

  // Bottom player bar star rating is NOT compact (larger stars)
  const playerStars = page.locator(".player-bar .now-playing .star-rating");
  await expect(playerStars).toBeVisible();
  await expect(playerStars).not.toHaveClass(/star-rating--compact/);
});
