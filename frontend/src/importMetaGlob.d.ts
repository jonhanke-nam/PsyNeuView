// Vite's import.meta.glob, which utils/componentIcons.ts uses to load the
// icons. tsconfig here doesn't pull in vite/client, so declare the one shape
// we use (as walkthroughs/demo.d.ts does for `?raw`).
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, string>;
}
