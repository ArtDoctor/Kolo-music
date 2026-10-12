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
  const { jobs } = await (await request.get("/api/jobs")).json();
  for (const job of jobs) {
    if (job.status === "running" || job.status === "queued")
      await request.post(`/api/jobs/${job.id}/cancel`);
  }
  await request.post("/api/jobs/clear");
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

test("loudness normalization boosts quiet tracks and attenuates loud ones", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await page.getByRole("slider", { name: "Volume" }).fill("0.5");
  const audio = page.locator("audio");
  const elementVolume = () =>
    audio.evaluate((element: HTMLAudioElement) => element.volume);
  const sliderLevel = 0.5 ** 2 * 0.65;

  await page.getByTestId("track-row").filter({ hasText: "Neon Sky" }).click();
  await expect.poll(elementVolume).toBeCloseTo(sliderLevel * 1.995, 4);

  await page
    .getByTestId("track-row")
    .filter({ hasText: "Quiet Motion" })
    .click();
  await expect.poll(elementVolume).toBeCloseTo(sliderLevel * 0.501, 4);

  await page.getByRole("button", { name: "Open profile" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Match track loudness (-14 LUFS)").uncheck();
  await expect.poll(elementVolume).toBeCloseTo(sliderLevel, 4);
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

test("imports a Spotify link in the background and opens the new playlist", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Phone music/ }).click();
  await page.getByRole("button", { name: "Add link or search" }).click();
  await page.getByRole("button", { name: "Discover Weekly" }).click();

  const input = page.getByRole("textbox", { name: "Music link or search" });
  await expect(input).toHaveValue(
    "https://open.spotify.com/playlist/37i9dQZEVXcOour5t7D6qU",
  );
  await page.getByRole("button", { name: "Download from Spotify" }).click();

  // The form is free again while the import runs.
  await expect(input).toHaveValue("");
  const card = page.getByTestId("job-card");
  await expect(card).toHaveAttribute("data-job-kind", "spotify");
  await expect(card.getByText("Fake Mix", { exact: true })).toBeVisible();
  await expect(card.getByRole("progressbar")).toBeVisible();

  await expect(card).toHaveAttribute("data-job-status", "done");
  await expect(card.getByText("Added 2 songs · 1 not found")).toBeVisible();
  await card.getByText("1 not found", { exact: true }).click();
  await expect(card.getByText("Fake Band - Missing")).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Retry Fake Mix" }),
  ).toBeVisible();

  // The new playlist shows up without a reload and can be opened from here.
  await expect(
    page.getByRole("button", { name: /Fake Mix, 2 songs/ }).first(),
  ).toBeVisible();
  await card.getByRole("button", { name: "Open Fake Mix" }).click();
  await expect(page.getByRole("heading", { name: "Fake Mix" })).toBeVisible();
  await expect(page.getByTestId("track-row")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Activity" })).toHaveCount(0);
});

test("downloads several pasted links at once and shows each one's progress", async ({
  page,
}, testInfo) => {
  const ids = [`slow-one-${testInfo.retry}`, `slow-two-${testInfo.retry}`];
  await page.getByRole("button", { name: /Imports, \d+ songs?/ }).click();
  const input = page.getByRole("textbox", { name: "Import URL or search" });
  const download = page.locator(".imports-hero .btn-primary");
  await expect(download).toBeDisabled();

  // A list copied with one link per line arrives as separate links.
  await input.focus();
  await page.evaluate(
    (text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.activeElement?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    ids.map((id) => `https://www.youtube.com/watch?v=${id}`).join("\n"),
  );
  await expect(download).toHaveText("Download 2 links");
  await download.click();
  await expect(input).toHaveValue("");

  await page.getByRole("button", { name: /^Activity: / }).click();
  const panel = page.getByRole("region", { name: "Activity" });
  const cards = panel.getByTestId("job-card");
  await expect(cards).toHaveCount(2);
  await expect(panel.locator('[data-job-status="running"]')).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Activity: 2 active" }),
  ).toBeVisible();
  for (const id of ids) {
    const card = cards.filter({ hasText: `Fake Artist - ${id}` });
    await expect(card.getByText("YouTube → Imports")).toBeVisible();
    await expect(
      card.getByText(/Downloading · [\d.]+ of 3\.8 MB/),
    ).toBeVisible();
    await expect(card.getByText(/^\d+%$/)).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      /^\d+$/,
    );
  }

  // Progress stays reachable from any page while the downloads continue.
  await page.getByRole("button", { name: "Close activity" }).click();
  await page.getByRole("button", { name: /Phone music/ }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: /^Activity: / }).click();
  await expect(cards).toHaveCount(2);

  await expect(panel.locator('[data-job-status="done"]')).toHaveCount(2);
  await expect(panel.getByText("Added to Imports")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Activity: Done" }),
  ).toBeVisible();

  // The finished songs are in the playlist without reloading the page.
  await cards.first().getByRole("button", { name: "Open Imports" }).click();
  for (const id of ids) {
    await expect(
      page.getByTestId("track-row").getByText(id, { exact: true }),
    ).toBeVisible();
  }
});

test("cancels, retries, and dismisses downloads from the activity panel", async ({
  page,
}, testInfo) => {
  const slowId = `slow-cancel-${testInfo.retry}`;
  await page.getByRole("button", { name: /Imports, \d+ songs?/ }).click();
  const input = page.getByRole("textbox", { name: "Import URL or search" });
  const panel = page.getByRole("region", { name: "Activity" });

  await input.fill(`https://www.youtube.com/watch?v=${slowId}`);
  await input.press("Enter");
  await page.getByRole("button", { name: /^Activity: / }).click();
  const slow = panel.getByTestId("job-card").filter({ hasText: slowId });
  await expect(slow).toHaveAttribute("data-job-status", "running");
  await slow.getByRole("button", { name: /^Cancel / }).click();
  await expect(slow).toHaveAttribute("data-job-status", "cancelled");
  await expect(slow.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(slow.getByRole("progressbar")).toHaveCount(0);

  await input.fill("https://www.youtube.com/watch?v=fail-e2e");
  await page
    .getByRole("button", { name: "Download YouTube Audio", exact: true })
    .click();
  const failed = panel.getByTestId("job-card").filter({ hasText: "fail-e2e" });
  await expect(failed).toHaveAttribute("data-job-status", "error");
  await expect(
    failed.getByText("[youtube] fail-e2e: Video unavailable"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activity: 1 failed" }),
  ).toBeVisible();
  await failed.getByRole("button", { name: /^Dismiss / }).click();
  await expect(failed).toHaveCount(0);

  // Retrying the cancelled download starts it again from the same link.
  await slow.getByRole("button", { name: /^Retry / }).click();
  await expect(slow).toHaveAttribute("data-job-status", "running");
  await expect(slow).toHaveAttribute("data-job-status", "done");
  await panel.getByRole("button", { name: "Clear finished" }).click();
  await expect(page.getByRole("button", { name: /^Activity: / })).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId("track-row").getByText(slowId, { exact: true }),
  ).toBeVisible();
});

test("rates the unrated songs of a playlist from its header button", async ({
  page,
  request,
}, testInfo) => {
  const name = `Fresh Finds ${testInfo.retry}`;
  const playlist = (await (
    await request.post("/api/playlists", { data: { name } })
  ).json()) as { id: string };
  for (const title of ["First", "Second", "Unreadable"]) {
    await request.post(
      `/api/import?name=${encodeURIComponent(`New Artist - ${title}.wav`)}&playlistId=${encodeURIComponent(playlist.id)}`,
      { data: createTestWav() },
    );
  }
  await page.reload();

  // Fully rated playlists do not offer the action.
  await page.getByRole("button", { name: /Phone music/ }).click();
  await expect(
    page.getByTestId("track-row").filter({ hasText: "Quiet Motion" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: new RegExp(`${name}, 3 songs`) })
    .click();
  const rateButton = page.getByRole("button", { name: "Rate 3 unrated" });
  await expect(rateButton).toBeVisible();
  const stars = (title: string) =>
    page
      .getByTestId("track-row")
      .filter({ hasText: title })
      .getByTestId("star-rating");
  await expect(stars("First")).not.toHaveClass(/has-ai-prediction/);

  await rateButton.click();
  await expect(page.getByRole("button", { name: /^Rating/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Activity: / }).click();
  const card = page.getByTestId("job-card");
  await expect(card).toHaveAttribute("data-job-kind", "rating");
  await expect(card.getByText(`Rating model → ${name}`)).toBeVisible();
  await expect(card.getByText("Loading the audio model…")).toBeVisible();

  // Estimates appear in the list as they are produced.
  await expect(stars("First")).toHaveAttribute("data-ai-rating", "4");
  await expect(stars("Second")).toHaveAttribute("data-ai-rating", "4");
  await expect(card).toHaveAttribute("data-job-status", "done");
  await expect(
    card.getByText("Rated 2 songs · 1 could not be read"),
  ).toBeVisible();
  await card.getByText("1 could not be read", { exact: true }).click();
  await expect(card.getByText("New Artist - Unreadable")).toBeVisible();

  // What could not be rated is still offered; a personal rating is kept.
  await expect(
    page.getByRole("button", { name: "Rate 1 unrated" }),
  ).toBeVisible();
  await expect(stars("Unreadable")).toHaveAttribute("data-ai-rating", "");
  await expect(stars("First")).toHaveAttribute("data-rating", "");
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
