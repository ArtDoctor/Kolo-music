import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Home,
  Plus,
  Search,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { playlistIcon } from "../appConfig";
import type { Playlist } from "../types";

interface SidebarProps {
  playlists: Playlist[];
  negativePlaylist?: Playlist;
  selectedPlaylist: string;
  settingsPage: boolean;
  collapsed: boolean;
  showHiddenPlaylists: boolean;
  onSelectPlaylist: (playlist: Playlist | { id: string; name: string }) => void;
  onCreatePlaylist: () => void;
  onToggleCollapsed: () => void;
  onToggleHidden: () => void;
}

export function Sidebar({
  playlists: visiblePlaylists,
  negativePlaylist,
  selectedPlaylist,
  settingsPage,
  collapsed: sidebarCollapsed,
  showHiddenPlaylists,
  onSelectPlaylist,
  onCreatePlaylist,
  onToggleCollapsed,
  onToggleHidden,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <button
        className="brand"
        onClick={() => onSelectPlaylist({ id: "home", name: "Home" })}
        aria-label="Go to Home"
      >
        <img className="brand-mark" src="/icon.svg" alt="" />
        <span>kolo</span>
      </button>

      <div className="playlist-label">
        <span>Playlists</span>
        <button
          onClick={onCreatePlaylist}
          title="Create playlist"
          aria-label="Create playlist"
        >
          <Plus />
        </button>
        <button
          onClick={onToggleCollapsed}
          title={sidebarCollapsed ? "Expand playlists" : "Collapse playlists"}
          aria-label={
            sidebarCollapsed ? "Expand playlists" : "Collapse playlists"
          }
        >
          {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
      </div>

      <nav className="playlist-nav">
        {visiblePlaylists.map((item) => {
          const Icon = playlistIcon(item.id);
          const active = !settingsPage && selectedPlaylist === item.id;
          return (
            <button
              key={item.id}
              className={active ? "active" : ""}
              onClick={() => onSelectPlaylist(item)}
              aria-label={`${item.name}, ${item.count} songs`}
            >
              <Icon fill={item.id === "liked" ? "currentColor" : "none"} />
              <span>{item.name}</span>
              <small>{item.count}</small>
            </button>
          );
        })}

        {negativePlaylist && (
          <div className="hidden-playlists-section">
            <button
              className="hidden-playlists-toggle"
              onClick={onToggleHidden}
              title={showHiddenPlaylists ? "Hide excluded" : "Show excluded"}
              aria-label={
                showHiddenPlaylists
                  ? "Hide excluded playlists"
                  : "Show excluded playlists"
              }
              aria-expanded={showHiddenPlaylists}
            >
              {showHiddenPlaylists ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </button>
            {showHiddenPlaylists && (
              <button
                key={negativePlaylist.id}
                className={`crossed-out ${!settingsPage && selectedPlaylist === negativePlaylist.id ? "active" : ""}`}
                onClick={() => onSelectPlaylist(negativePlaylist)}
                aria-label={`${negativePlaylist.name}, ${negativePlaylist.count} songs`}
                title="Excluded tracks (Not your vibe)"
              >
                <Ban />
                <span>{negativePlaylist.name}</span>
                <small>{negativePlaylist.count}</small>
              </button>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}

interface TopBarProps {
  selectedPlaylist: string;
  settingsPage: boolean;
  query: string;
  profileOpen: boolean;
  activity?: ReactNode;
  onHome: () => void;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onToggleProfile: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  selectedPlaylist,
  settingsPage,
  query,
  profileOpen,
  activity,
  onHome,
  onQueryChange,
  onClearQuery,
  onToggleProfile,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className={`home-nav-btn ${selectedPlaylist === "home" && !settingsPage ? "active" : ""}`}
          onClick={onHome}
          title="Go to Home"
          aria-label="Home"
        >
          <Home />
        </button>
      </div>

      <label className="search-box">
        <Search />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search your music"
        />
        {query && (
          <button onClick={onClearQuery}>
            <X />
          </button>
        )}
      </label>

      <div className="topbar-actions">
        {activity}
        <div className="profile-wrap">
          <button
            className="avatar"
            onClick={onToggleProfile}
            aria-label="Open profile"
          >
            AK
          </button>
          {profileOpen && (
            <div className="profile-menu popover-enter">
              <div className="profile-summary">
                <span>
                  <UserRound />
                </span>
                <div>
                  <strong>My profile</strong>
                  <small>Local listener</small>
                </div>
              </div>
              <button onClick={onOpenSettings}>
                <Settings2 /> Settings
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
