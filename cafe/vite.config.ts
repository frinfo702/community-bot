import { defineConfig } from "vite";

// base "./" keeps asset URLs relative: Discord serves the Activity under a
// proxy prefix, where absolute "/assets/..." paths would 404.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2022" },
});
