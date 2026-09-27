# Interface design notes

Kolo uses a dark, low-chrome interface so the library and player controls remain the focus.

## Palette

- background: `#080808`
- raised surfaces: `#121212`, `#1c1c1c`, and `#262626`
- primary text: `#f4f4f1`
- muted text: `#858581`
- default accent: `#0d8275`

The accent is a CSS custom property and can be changed in Settings. Status and interaction states should use the accent rather than introducing unrelated colors.

## Layout

- The playlist sidebar may be collapsed.
- The main pane owns browsing, search, filters, and settings.
- Playback controls stay in a fixed bottom bar.
- Secondary panels such as the queue and import dialog overlay the main view.
- Dense track rows are preferred to large cards except on the home screen.

## Interaction

Controls need a visible hover or focus state and an accessible label. Loading, empty, success, and failure states should use plain language. Animation should clarify state changes without delaying playback or navigation.

The Outfit variable font is bundled through `@fontsource-variable/outfit`; the app does not depend on a remote font request.
