import { defineConfig } from 'vite';

// relative base so the build works on GitHub Pages project sites,
// LAN previews and any static host without changes
export default defineConfig({
  base: './',
});
