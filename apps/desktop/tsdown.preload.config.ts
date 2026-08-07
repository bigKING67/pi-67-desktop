import { defineConfig } from "tsdown";

export default defineConfig({
  clean: false,
  deps: {
    alwaysBundle: ["@pi67/protocol/prompt-attachment-limits"]
  },
  dts: false,
  format: "cjs"
});
