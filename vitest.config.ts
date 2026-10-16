import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // persona.md は wrangler.jsonc の Text ルールと同じく文字列として読み込む
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
