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
});
