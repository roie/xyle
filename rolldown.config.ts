import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    editor: "src/editor.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
  },
});
