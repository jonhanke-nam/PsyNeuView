// Vite serves `?raw` imports as strings; tsconfig here doesn't pull in
// vite/client, so declare the one shape we use.
declare module "*.yaml?raw" {
  const contents: string;
  export default contents;
}
