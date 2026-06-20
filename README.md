# TabLoop

TabLoop is a modern Chrome Extension designed to help you conquer tab hoarding. By setting a customizable limit on your open tabs, TabLoop forces you to confront your pile. When you hit your limit and open a new tab, the extension intercepts it, surfacing your oldest tab to be dealt with. The link you were trying to open isn't thrown away — it's saved to your **Stash**, which you can restore from the toolbar popup. You can also stash any open tab yourself to instantly free up a slot.

## Features

- **Strict Tab Limits**: Define your absolute maximum number of tabs globally or per-window.
- **Smart Recycling**: Choose between recycling the *oldest created* tab or the *least recently used* (LRU) tab.
- **Stash**: Park any open tab in your Stash to instantly free up a slot — it closes but is saved (with its title) for later. Tabs blocked at the limit land here too, so nothing is lost. A toolbar badge shows how many are waiting; restore them from the popup once you've made room.
- **Live Tab Counter**: The toolbar popup shows your current tab count against your limit at a glance.
- **Pinned Tab Protection**: Exclude your important pinned tabs from being touched (and from counting toward the limit).
- **System-Page Exemption**: Chrome's internal pages (`chrome://…`) and TabLoop's own settings page never count toward your limit and are never recycled — only the new-tab page stays enforced.
- **Incognito Exemption**: Keep private browsing separate — tabs in incognito windows can be excluded from the limit (and from recycling). Enabled by default.
- **Premium Interface**: Configure your preferences via a sleek, dark-glassmorphism options page.

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
