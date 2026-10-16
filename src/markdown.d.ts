// The Text rule in wrangler.jsonc bundles .md files as strings
declare module "*.md" {
  const text: string;
  export default text;
}
