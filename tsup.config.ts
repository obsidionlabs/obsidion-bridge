import { defineConfig } from "tsup"

export default defineConfig(
  (["esm", "cjs"] as const).map((format) => ({
    entry: ["src/**/*.ts"],
    dts: true,
    clean: true,
    format,
    outDir: `dist/${format}`,
  })),
)
