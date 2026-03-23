import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const srcRoot = resolve(extensionRoot, "src");
const outdir = resolve(srcRoot, "generated");

await mkdir(outdir, { recursive: true });

await build({
  absWorkingDir: extensionRoot,
  bundle: true,
  entryNames: "[name]",
  entryPoints: {
    "recording-detail": resolve(srcRoot, "ui", "recording-detail-entry.jsx"),
    recordings: resolve(srcRoot, "ui", "recordings-entry.jsx")
  },
  format: "esm",
  jsx: "automatic",
  loader: {
    ".js": "jsx"
  },
  logLevel: "info",
  outdir,
  platform: "browser",
  sourcemap: false,
  target: ["chrome120"]
});
