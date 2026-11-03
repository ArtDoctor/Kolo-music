import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  togglePlayback: () => void;
  next: () => void;
  previous: () => void;
  seekBy: (seconds: number) => void;
  volumeBy: (delta: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleLike: () => void;
  rate: (rating: number | null) => void;
  focusSearch: () => void;
  toggleQueue: () => void;
  openShortcuts: () => void;
}

interface Shortcut {
  keys: string[];
  label: string;
  matches: (event: KeyboardEvent) => boolean;
  run: (handlers: ShortcutHandlers, event: KeyboardEvent) => void;
  repeatable?: boolean;
  command?: boolean;
}

const digit = (event: KeyboardEvent) =>
  /^(?:Digit|Numpad)[1-5]$/.test(event.code);

// Physical keys rather than characters, so a non-Latin layout (where M types
// "ь") still triggers the shortcut.
const key = (code: string) => (event: KeyboardEvent) => event.code === code;

// Descriptions and matching live together so the help stays in sync.
const bindings: { group: string; items: Shortcut[] }[] = [
  {
    group: "Playback",
    items: [
      {
        keys: ["Space"],
        label: "Play / pause",
        matches: (event) => event.code === "Space" || event.key === " ",
        run: (handlers) => handlers.togglePlayback(),
      },
      {
        keys: ["←", "→"],
        label: "Seek −5 / +5 seconds",
        matches: (event) =>
          !event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key),
        run: (handlers, event) =>
          handlers.seekBy(event.key === "ArrowLeft" ? -5 : 5),
        repeatable: true,
      },
      {
        keys: ["Shift", "← / →"],
        label: "Previous / next song",
        matches: (event) =>
          event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key),
        run: (handlers, event) =>
          event.key === "ArrowLeft" ? handlers.previous() : handlers.next(),
      },
      {
        keys: ["↑", "↓"],
        label: "Volume +5% / −5%",
        matches: (event) => ["ArrowUp", "ArrowDown"].includes(event.key),
        run: (handlers, event) =>
          handlers.volumeBy(event.key === "ArrowUp" ? 0.05 : -0.05),
        repeatable: true,
      },
      {
        keys: ["M"],
        label: "Mute / unmute",
        matches: key("KeyM"),
        run: (handlers) => handlers.toggleMute(),
      },
      {
        keys: ["S"],
        label: "Toggle shuffle",
        matches: key("KeyS"),
        run: (handlers) => handlers.toggleShuffle(),
      },
      {
        keys: ["R"],
        label: "Repeat: off → all → one",
        matches: key("KeyR"),
        run: (handlers) => handlers.cycleRepeat(),
      },
    ],
  },
  {
    group: "Rating",
    items: [
      {
        keys: ["1–5"],
        label: "Rate 1–5 stars",
        matches: (event) => digit(event) && !event.shiftKey,
        run: (handlers, event) => handlers.rate(Number(event.code.slice(-1))),
      },
      {
        keys: ["Shift", "1–5"],
        label: "Rate a half star less",
        matches: (event) => digit(event) && event.shiftKey,
        run: (handlers, event) =>
          handlers.rate(Number(event.code.slice(-1)) - 0.5),
      },
      {
        keys: ["0"],
        label: "Clear rating",
        matches: (event) => /^(?:Digit|Numpad)0$/.test(event.code),
        run: (handlers) => handlers.rate(null),
      },
      {
        keys: ["L"],
        label: "Like / unlike",
        matches: key("KeyL"),
        run: (handlers) => handlers.toggleLike(),
      },
    ],
  },
  {
    group: "Navigation",
    items: [
      {
        keys: ["/"],
        label: "Focus search",
        matches: (event) => event.code === "Slash" && !event.shiftKey,
        run: (handlers) => handlers.focusSearch(),
      },
      {
        keys: ["Ctrl / ⌘", "K"],
        label: "Focus search",
        matches: key("KeyK"),
        run: (handlers) => handlers.focusSearch(),
        command: true,
      },
      {
        keys: ["Q"],
        label: "Toggle queue",
        matches: key("KeyQ"),
        run: (handlers) => handlers.toggleQueue(),
      },
      {
        keys: ["?"],
        label: "Show keyboard shortcuts",
        matches: (event) => event.shiftKey && event.code === "Slash",
        run: (handlers) => handlers.openShortcuts(),
      },
    ],
  },
];

// Bindings that share a label are listed once, with each key combo as an
// alternative.
export const SHORTCUTS: {
  group: string;
  items: { combos: string[][]; label: string }[];
}[] = bindings.map(({ group, items }) => {
  const rows: { combos: string[][]; label: string }[] = [];
  for (const { keys, label } of items) {
    const row = rows.find((item) => item.label === label);
    if (row) row.combos.push(keys);
    else rows.push({ combos: [keys], label });
  }
  return { group, items: rows };
});

const shortcuts = bindings.flatMap(({ items }) => items);

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest("textarea, select, [contenteditable]")) return;
        if (target instanceof HTMLInputElement) {
          if (!["range", "checkbox", "radio"].includes(target.type)) return;
          if (target.type === "range" && event.key.startsWith("Arrow")) return;
          // Space toggles a focused checkbox rather than playback.
          if (target.type !== "range" && event.code === "Space") return;
        }
      }

      const command = event.ctrlKey || event.metaKey;
      const shortcut = shortcuts.find(
        (item) => Boolean(item.command) === command && item.matches(event),
      );
      if (!shortcut || (event.repeat && !shortcut.repeatable)) return;
      event.preventDefault();
      shortcut.run(handlersRef.current, event);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
