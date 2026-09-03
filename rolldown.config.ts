import packageJson from "./package.json" with { type: "json" };
import { defineConfig } from "rolldown";

const dependencies = Object.keys(packageJson.dependencies);

export default defineConfig([
  {
    input: {
      editor: "src/editor.ts",
    },
    platform: "browser",
    output: {
      dir: "dist",
      format: "esm",
    },
  },
  {
    input: {
      cli: "src/cli.ts",
    },
    external: dependencies,
    platform: "node",
    output: {
      dir: "dist",
      format: "esm",
    },
  },
]);
