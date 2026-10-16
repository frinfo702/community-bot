import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // Load persona.md as a string, same as the Text rule in wrangler.jsonc
      name: "markdown-as-text",
      transform(source, id) {
        if (id.endsWith(".md")) {
          return { code: `export default ${JSON.stringify(source)};`, map: null };
        }
      },
    },
  ],
  resolve: {
    alias: {
      // node has no workerd DurableObject; tests use a stub instead
      "cloudflare:workers": fileURLToPath(
        new URL("./test/stubs/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
});
