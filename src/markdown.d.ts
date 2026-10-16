// wrangler.jsonc の Text ルールで .md は文字列としてバンドルされる
declare module "*.md" {
  const text: string;
  export default text;
}
