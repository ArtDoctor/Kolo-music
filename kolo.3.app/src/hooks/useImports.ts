import { isTauri } from "@tauri-apps/api/core";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DownloadRequest } from "../jobs";
import {
  createPlaylist,
  importTracks,
  isSpotifyLink,
  isYouTubeLink,
  openExternal,
  parseDownloadLinks,
  saveLike,
  youtubeSearchUrl,
} from "../library";
import type { LibrarySnapshot } from "../types";

interface ImportsOptions {
  library: LibrarySnapshot | null;
  selectedPlaylist: string;
  setSelectedPlaylist: Dispatch<SetStateAction<string>>;
  setSettingsPage: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  refreshLibrary: () => Promise<LibrarySnapshot | undefined>;
  // Starts background downloads and resolves to how many were accepted.
  startDownloads: (requests: DownloadRequest[]) => Promise<number>;
}

export function useImports({
  library,
  selectedPlaylist,
  setSelectedPlaylist,
  setSettingsPage,
  setNotice,
  refreshLibrary,
  startDownloads,
}: ImportsOptions) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
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

  // Songs live in folders, so views such as Liked songs or a rating filter
  // cannot receive files; anything added from there goes to Imports.
  function folderTarget() {
    return library?.playlists.some(
      (playlist) => playlist.id === selectedPlaylist && playlist.id !== "liked",
    )
      ? selectedPlaylist
      : "imported";
  }

  async function downloadLinks() {
    const links = parseDownloadLinks(linkInput);
    if (!links.length) return;
    const target = folderTarget();
    const targetName = library?.playlists.find(
      (playlist) => playlist.id === target,
    )?.name;
    // A Spotify collection becomes its own playlist unless the open playlist
    // is one the user fills by hand.
    const spotifyIntoSelected =
      selectedPlaylist.startsWith("custom:") ||
      selectedPlaylist === "discovery" ||
      selectedPlaylist === "imported";
    const started = await startDownloads(
      links.map((url) =>
        isSpotifyLink(url) && !spotifyIntoSelected
          ? { url, createPlaylist: true }
          : {
              url,
              playlistId: target,
              playlistName: targetName,
              createPlaylist: false,
            },
      ),
    );
    // The panel stays open so the next link can be pasted straight away.
    if (started) setLinkInput("");
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
    importPlaylistRef.current = folderTarget();
    if (isTauri()) void beginImport();
    else fileInputRef.current?.click();
  }

  return {
    linkOpen,
    setLinkOpen,
    linkInput,
    setLinkInput,
    fileInputRef,
    createNewPlaylist,
    handleLink,
    downloadLinks,
    beginImport,
    openImport,
  };
}
