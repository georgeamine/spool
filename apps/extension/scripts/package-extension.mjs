import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(extensionDir, "..", "..");
const outputZipPath = path.join(repoRoot, "spool-extension.zip");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

async function main() {
  run(process.execPath, [path.join(scriptDir, "build-ui.mjs")], {
    cwd: extensionDir
  });

  const stagingDir = await mkdtemp(path.join(os.tmpdir(), "spool-extension-package-"));

  try {
    await cp(path.join(extensionDir, "src"), path.join(stagingDir, "src"), {
      recursive: true
    });
    await cp(path.join(extensionDir, "bobbin.png"), path.join(stagingDir, "bobbin.png"));

    const publicDir = path.join(extensionDir, "public");
    await cp(publicDir, path.join(stagingDir, "public"), {
      recursive: true,
      force: true,
      errorOnExist: false
    }).catch(() => {});

    const manifestPath = path.join(extensionDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.key;
    await writeFile(path.join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await rm(outputZipPath, {
      force: true
    });

    run("zip", ["-rq", outputZipPath, "."], {
      cwd: stagingDir
    });

    console.log(`Packaged ${outputZipPath}`);
  } finally {
    await rm(stagingDir, {
      force: true,
      recursive: true
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
