import { isTauri } from "@tauri-apps/api/core";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  createPlaylist,
  downloadSpotify,
  downloadYoutube,
  getSpotifyStatus,
  importTracks,
  isYouTubeLink,
  openExternal,
  saveLike,
  youtubeSearchUrl,
  type SpotifyDownloadStatus,
} from "../library";
import type { LibrarySnapshot } from "../types";

interface ImportsOptions {
  library: LibrarySnapshot | null;
  selectedPlaylist: string;
  setSelectedPlaylist: Dispatch<SetStateAction<string>>;
  setSettingsPage: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  refreshLibrary: () => Promise<LibrarySnapshot | undefined>;
}

export function useImports({
  library,
  selectedPlaylist,
  setSelectedPlaylist,
  setSettingsPage,
  setNotice,
  refreshLibrary,
}: ImportsOptions) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [spotifyStatus, setSpotifyStatus] =
    useState<SpotifyDownloadStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importPlaylistRef = useRef("imported");

  async function createNewPlaylist() {
    const name = window.prompt("Name your new playlist:")?.trim();
    if (!name) return;
    try {
      const created = await createPlaylist(name);
      await refreshLibrary();
      setSelectedPlaylist(created.id);
      setSettingsPage(false);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Could not create playlist.",
      );
    }
  }

  async function handleLink() {
    const input = linkInput.trim();
    if (!input) return;
    if (!/^https?:\/\//i.test(input)) {
      await openExternal(youtubeSearchUrl(input));
      return;
    }
    try {
      const parsed = new URL(input);
      if (parsed.hostname === "open.spotify.com") {
        await openExternal(input);
        setNotice(
          "Opened Spotify in browser. Click 'Download from Spotify' to download into Kolo.",
        );
        return;
      }
      if (!isYouTubeLink(input))
        throw new Error("Enter a YouTube or Spotify link, or a search phrase.");
      await openExternal(input);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Could not open link.",
      );
    }
  }

  async function downloadSpotifyLink() {
    const input = linkInput.trim();
    if (!input) return;
    try {
      setDownloading(true);
      setNotice("Fetching Spotify playlist info…");
      const isCustomOrSpecial =
        selectedPlaylist.startsWith("custom:") ||
        selectedPlaylist === "discovery" ||
        selectedPlaylist === "imported";
      const createNew = !isCustomOrSpecial;
      const targetPlaylist = createNew ? undefined : selectedPlaylist;
      const res = await downloadSpotify(
        input,
        targetPlaylist,
        undefined,
        createNew,
      );

      if (isTauri()) {
        await refreshLibrary();
        if (res.playlistId) setSelectedPlaylist(res.playlistId);
        setNotice(`Finished downloading ${res.playlistName || "playlist"}!`);
        setDownloading(false);
        setLinkOpen(false);
        return;
      }

      const pollTimer = window.setInterval(async () => {
        try {
          const status = await getSpotifyStatus();
          setSpotifyStatus(status);
          if (status.status === "downloading" && status.currentTrack) {
            setNotice(
              `[${status.downloaded ?? 0}/${status.total ?? 0}] ${status.currentTrack}`,
            );
            if (status.downloaded && status.downloaded > 0) {
              await refreshLibrary();
            }
          }
          if (status.status === "done" || !status.active) {
            window.clearInterval(pollTimer);
            setDownloading(false);
            setSpotifyStatus(null);
            await refreshLibrary();
            if (status.playlistId) setSelectedPlaylist(status.playlistId);
            setNotice(
              `Imported ${status.downloaded ?? "all"} songs from ${status.playlistName || "Spotify"}!`,
            );
            setLinkOpen(false);
          } else if (status.status === "error") {
            window.clearInterval(pollTimer);
            setDownloading(false);
            setSpotifyStatus(null);
            setNotice(
              `Spotify import failed: ${status.error || "Unknown error"}`,
            );
          }
        } catch {
          // ignore polling errors
        }
      }, 1000);
    } catch (reason) {
      setDownloading(false);
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Download failed. Make sure Python and yt-dlp are installed.",
      );
    }
  }

  async function downloadLink() {
    try {
      setDownloading(true);
      const target =
        selectedPlaylist === "liked" ||
        selectedPlaylist.startsWith("rating:") ||
        selectedPlaylist === "home"
          ? "imported"
          : selectedPlaylist;
      await downloadYoutube(target, linkInput.trim());
      await refreshLibrary();
      setLinkOpen(false);
      setNotice("YouTube audio added with peak loudness limiter applied.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Download failed. Is yt-dlp and ffmpeg installed?",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function beginImport(files?: File[]) {
    try {
      const target = importPlaylistRef.current;
      const likedImport = selectedPlaylist === "liked";
      const existing = new Set(library?.tracks.map((track) => track.id));
      const count = await importTracks(target, files);
      if (!count) return;
      const snapshot = await refreshLibrary();
      if (likedImport && snapshot) {
        await Promise.all(
          snapshot.tracks
            .filter(
              (track) => !existing.has(track.id) && track.playlistId === target,
            )
            .map((track) => saveLike(track.id, true)),
        );
        await refreshLibrary();
      }
      setSelectedPlaylist(likedImport ? "liked" : target);
      setSettingsPage(false);
      setNotice(`${count} ${count === 1 ? "song" : "songs"} imported.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Import failed.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function openImport() {
    importPlaylistRef.current =
      selectedPlaylist === "liked" ||
      selectedPlaylist.startsWith("rating:") ||
      selectedPlaylist === "home"
        ? "imported"
        : selectedPlaylist;
    if (isTauri()) void beginImport();
    else fileInputRef.current?.click();
  }

  return {
    linkOpen,
    setLinkOpen,
    linkInput,
    setLinkInput,
    downloading,
    spotifyStatus,
    fileInputRef,
    createNewPlaylist,
    handleLink,
    downloadSpotifyLink,
    downloadLink,
    beginImport,
    openImport,
  };
}
