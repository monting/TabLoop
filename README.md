# TabLoop

TabLoop is a modern browser extension designed to help you conquer tab hoarding. By setting a customizable limit on your open tabs, TabLoop forces you to confront your pile. When you're at your limit and open a new tab, the extension closes the empty new tab and surfaces your oldest tab to be dealt with instead. To deliberately set a tab aside for later, stash it yourself from the toolbar popup — it closes, frees a slot, and can be restored anytime. All of TabLoop's interface lives in that popup and the settings page.

## Features

- **Strict Tab Limits**: Define your absolute maximum number of tabs globally or per-window.
- **Smart Recycling**: Choose between recycling the *oldest created* tab or the *least recently used* (LRU) tab.
- **Stash**: Park any open tab in your Stash to instantly free up a slot — it closes but is saved for later. Syncs across devices when the "Sync stash" setting is enabled (uses `chrome.storage.sync` under the hood, showing `🟢 Stash` if settings sync is active and `🔴 Local Stash` if stored locally).
- **Live Tab Counter**: The toolbar popup shows your current tab count against your limit at a glance.
- **Pinned Tab Protection**: Exclude your important pinned tabs from being touched (and from counting toward the limit).
- **System-Page Exemption**: Chrome's internal pages (`chrome://…`) and TabLoop's own settings page never count toward your limit and are never recycled — only the new-tab page stays enforced.
- **Premium Interface**: Configure your preferences via a sleek, dark-glassmorphism options page.

## Design Notes

- **No "Hijack New Tab Page" feature (removed).** TabLoop deliberately does not override the browser's new-tab page, and it never redirects the page you navigate to. An earlier version shipped a toggle that swapped the new-tab page for a TabLoop dashboard, but Manifest V3 registers `chrome_url_overrides` statically — there is no API to turn the override off at runtime. That made the toggle's "off" state impossible to honor: with the override always active, we could never fall back to the browser's default (blank) new-tab page, so turning the setting on or off had no real effect. The feature (the override, the `hijackNewTab` setting, and the new-tab exemption it implied) was removed entirely rather than ship a control that can't work. The only interface surfaces are the toolbar popup and the settings page. New tabs always show the browser's native new-tab page.
- **No Identity Permissions Required**: To keep user privacy clean and permissions minimal, TabLoop does not require or declare the `identity` or `identity.email` permissions. Sync status is determined by user preference toggles, rather than tracking your browser profile's active Google account state directly.

## How to Run Locally for Development

This extension is built with Vite, TypeScript, and standard Manifest V3.

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm run dev
   ```

3. **Load into Chrome**:
   - Open your Chrome browser and navigate to `chrome://extensions/`
   - Enable **Developer mode** in the top right corner.
   - Click **Load unpacked** and select the newly generated `dist` folder located inside the `tabLoop` project directory.
   - Vite watches for changes: the popup and options pages hot-reload automatically. Changes to the background service worker need a manual reload from the `chrome://extensions/` page.

## How to Build for Production

To create a production-ready build for the Chrome Web Store:

```bash
npm run build
```

This will bundle the extension assets tightly into the `dist` folder. Simply ZIP the `dist` folder, and it's ready to upload to the Chrome Web Store developer dashboard. Store imagery (icons and promo marquee) are located in the `public` directory.
