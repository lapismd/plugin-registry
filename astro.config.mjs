import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://registry.lapis.md",
  trailingSlash: "always",
  output: "static",
  ...(process.env.LAPIS_REGISTRY_PUBLIC_DIR
    ? { publicDir: process.env.LAPIS_REGISTRY_PUBLIC_DIR }
    : {}),
});
