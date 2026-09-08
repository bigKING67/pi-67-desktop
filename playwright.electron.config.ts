import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Native Electron loads built app:// assets and needs no Vite server.
export default defineConfig({
  ...config,
  webServer: undefined,
  use: { ...config.use, baseURL: undefined },
  projects: config.projects?.filter((project) => project.name === "electron")
});
