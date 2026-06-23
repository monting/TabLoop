import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

const target = process.env.TARGET || "chrome";

export default defineConfig({
  plugins: [
    webExtension({
      browser: target,
      manifest: "manifest.json",
    }),
  ],
  build: {
    // Keep each browser's bundle in its own folder so they never clobber each
    // other and can be zipped/loaded independently.
    outDir: `dist/${target}`,
    minify: false,
  },
});

