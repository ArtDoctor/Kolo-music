import { Check, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { accentPresets } from "../data";
import type { PlayerSettings } from "../types";
import { StarRating } from "./StarRating";

export function SettingsPage({
  settings,
  onChange,
  dataRoot,
}: {
  settings: PlayerSettings;
  onChange: (settings: PlayerSettings) => void;
  dataRoot: string;
}) {
  return (
    <div className="settings-content">
      <span className="page-kicker">Preferences</span>
      <h1>Settings</h1>
      <p>
        Customize how Kolo looks, plays audio, and manages your local library.
      </p>

      <section>
        <div>
          <h2>Accent color</h2>
          <p>Choose the single highlight color used throughout the player.</p>
        </div>
        <div className="color-options">
          {accentPresets.map((color) => (
            <button
              key={color}
              className={settings.accent === color ? "selected" : ""}
              style={{ background: color }}
              onClick={() => onChange({ ...settings, accent: color })}
              aria-label={`Use accent ${color}`}
            >
              {settings.accent === color && <Check />}
            </button>
          ))}
          <label className="custom-color">
            <Plus />
            <input
              type="color"
              value={settings.accent}
              onChange={(event) =>
                onChange({ ...settings, accent: event.target.value })
              }
              aria-label="Custom accent color"
            />
          </label>
        </div>
      </section>

      <section>
        <div>
          <h2>Loudness normalization</h2>
          <p>
            Plays every track at about the same loudness. Loud masters are
            turned down and quiet tracks are turned up, whatever source they
            came from.
          </p>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          <input
            type="checkbox"
            checked={settings.loudnessLimiter ?? true}
            onChange={(e) =>
              onChange({ ...settings, loudnessLimiter: e.target.checked })
            }
          />
          <span>Match track loudness (-14 LUFS)</span>
        </label>
      </section>

      <section>
        <div>
          <h2>Vibe filter</h2>
          <p>
            Only show tracks above your chosen AI confidence. Unscored songs
            remain visible.
          </p>
        </div>
        <div className="setting-slider">
          <input
            className="range"
            aria-label="Vibe filter threshold"
            type="range"
            min="0"
            max=".9"
            step=".05"
            value={settings.vibeFilter}
            onChange={(event) =>
              onChange({ ...settings, vibeFilter: Number(event.target.value) })
            }
            style={
              {
                "--range-progress": `${(settings.vibeFilter / 0.9) * 100}%`,
              } as CSSProperties
            }
          />
          <span>
            {settings.vibeFilter
              ? `${Math.round(settings.vibeFilter * 100)}% minimum`
              : "Off"}
          </span>
        </div>
      </section>

      <section>
        <div>
          <h2>Music folder</h2>
          <p>
            Kolo scans this folder and stores your ratings and likes in its
            private <code>.kolo</code> directory.
          </p>
        </div>
        <span className="path-value">{dataRoot}</span>
      </section>

      <section>
        <div>
          <h2>Ratings and likes</h2>
          <p>
            Click either half of a star to rate in half-star steps. Use the
            heart to add a song to Liked songs independently of its rating.
          </p>
        </div>
        <StarRating value={3.5} onChange={() => undefined} />
      </section>
    </div>
  );
}
