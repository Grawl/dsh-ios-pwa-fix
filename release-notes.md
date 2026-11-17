# Release notes

## 1.5.0

- Moved the layout into its own sheet, `lib/layout.css`, inserted by the client
  and copied into the bundle by `pnpm build-css`.
- Dropped the measured status-bar strip: the sheet reads `env()` directly.
- Dropped the `top` and `strip` settings, which only fed that strip.
- Kept the keyboard pin, and take back the visual-viewport pan that iOS applies
  to a focused field.
- Added oxlint, oxfmt, stylelint, a bundle/sheet sync check and a CI job.

## 1.3.2

- Stopped the rubber-band on the app's own scroll container, not only the body.

## 1.3.1

- Removed the header bar blur and the skin's fade bands.
- Stopped iOS rubber-band and pull-to-refresh from revealing the page.

## 1.3.0

- Removed the key bar. The plugin is a layout patch only.
- Added `viewport-fit=cover`, so the page extends under the status bar and the
  Home indicator.
- Added the bottom padding for the Home indicator.
- Hid the skin's fixed blurred fade bands at the screen edges.

## 1.2.0

- Added the key bar: master switch and five groups, all on by default.
- Added the **iOS Web App Fix** title, description, and icon.

## 1.1.0

- Fixed slow layout and blank areas after rotation.

## 1.0.0

- First public release: status-bar strip, keyboard pin, 16px text fields.

## Known issues

These issues reproduce in DSH without this plugin:

- A predictive-text suggestion can insert only a space after an edit.
- The iPad keyboard hide key can play several clicks.

The layout patch changes layout only. It does not change system keyboard sounds.
