# Source provenance

Selected core and renderer code copied from local cli-tasker commit `5edde82336da3f600a9041b03668e4a772dee4f7`. The original app now lives at [Carlos-err406/tasker-ref](https://github.com/Carlos-err406/tasker-ref) and remains reference-only. No account grants or old cloud configuration were copied from that app. No Tasks.org code copied. Public redistribution terms must be settled before publishing.

The menu-bar artwork redraws cli-tasker's `apps/desktop/public/trayTemplate.png` and `trayTemplate@2x.png` checkbox with 1.5 pt pixel-aligned strokes and a 1 pt margin, so it stays sharp next to system icons. It is emitted as a SwiftBar template image at 18 points so macOS handles appearance tinting.

The help reference is adapted from cli-tasker `apps/desktop/src/components/HelpPanel.tsx`: metadata, date, search and editing references are retained. It uses the shared panel header; keyboard hints only describe available SwiftBar actions.

Google consent-screen artwork uses the original `cli-tasker/apps/desktop/public/icon.png`, preserved byte-for-byte as `assets/google-consent/tasker-original-1024.png`. The 120 px PNG is a size export of that source; the design and installed tray assets are unchanged.
