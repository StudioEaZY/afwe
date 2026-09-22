#!/usr/bin/env node

const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawnSync } = require("child_process");

const PKG_VERSION = require("../package.json").version;
const GITHUB_REPO = "StudioEaZY/afwe";

function getBinaryName() {
  const platform = os.platform();
  const arch = os.arch();

  let target = "";
  if (platform === "win32") {
    if (arch === "x64") target = "x86_64-pc-windows-msvc";
  } else if (platform === "darwin") {
    if (arch === "arm64") target = "aarch64-apple-darwin";
    else if (arch === "x64") target = "x86_64-apple-darwin";
  } else if (platform === "linux") {
    if (arch === "x64") target = "x86_64-unknown-linux-gnu";
    else if (arch === "arm64") target = "aarch64-unknown-linux-gnu";
  }

  if (!target) {
    throw new Error(
      `Unsupported platform or architecture: ${platform}-${arch}. You can build from source with 'cargo install --path crates/afwe-cli'.`
    );
  }

  const ext = platform === "win32" ? ".exe" : "";
  return {
    target,
    binaryFilename: `afwe-${target}${ext}`,
    localExecutableName: `afwe${ext}`
  };
}

function getCacheDir() {
  const home = os.homedir();
  const dir = path.join(home, ".afwe", "bin");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function findLocalDevBinary() {
  // If running in development inside the repo, check local target directory
  const possiblePaths = [
    path.resolve(__dirname, "../../../target/release/afwe.exe"),
    path.resolve(__dirname, "../../../target/release/afwe"),
    path.resolve(__dirname, "../../../target/debug/afwe.exe"),
    path.resolve(__dirname, "../../../target/debug/afwe")
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (targetUrl) => {
      https
        .get(
          targetUrl,
          {
            headers: {
              "User-Agent": "afwe-npm-installer"
            }
          },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return request(res.headers.location);
            }
            if (res.statusCode !== 200) {
              file.close();
              fs.unlinkSync(destPath);
              return reject(
                new Error(`Download failed from ${targetUrl} with status code ${res.statusCode}`)
              );
            }
            res.pipe(file);
            file.on("finish", () => {
              file.close(() => {
                if (os.platform() !== "win32") {
                  fs.chmodSync(destPath, 0o755);
                }
                resolve();
              });
            });
          }
        )
        .on("error", (err) => {
          file.close();
          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          } catch (_) {}
          reject(err);
        });
    };

    request(url);
  });
}

async function getBinaryPath() {
  // 1. Check if AFWE_BIN env var is provided
  if (process.env.AFWE_BIN && fs.existsSync(process.env.AFWE_BIN)) {
    return process.env.AFWE_BIN;
  }

  // 2. Check local dev binary
  const localDev = findLocalDevBinary();
  if (localDev) {
    return localDev;
  }

  // 3. Check ~/.afwe/bin/afwe-<target>-<version>
  const { target, localExecutableName } = getBinaryName();
  const cacheDir = getCacheDir();
  const cachedBin = path.join(cacheDir, `afwe-${target}-v${PKG_VERSION}${os.platform() === "win32" ? ".exe" : ""}`);

  if (fs.existsSync(cachedBin)) {
    return cachedBin;
  }

  // 4. Download from GitHub Release
  const releaseTag = `v${PKG_VERSION}`;
  const ext = os.platform() === "win32" ? ".exe" : "";
  const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${releaseTag}/afwe-${target}${ext}`;

  process.stderr.write(`[afwe] Downloading AFWE native binary (${releaseTag} for ${target})...\n`);
  try {
    await downloadBinary(downloadUrl, cachedBin);
    process.stderr.write(`[afwe] Installed successfully to ${cachedBin}\n`);
    return cachedBin;
  } catch (err) {
    throw new Error(
      `Unable to download native afwe binary (${err.message}).\n` +
      `You can build and install manually with: cargo install --path crates/afwe-cli`
    );
  }
}

async function main() {
  try {
    const binPath = await getBinaryPath();
    const args = process.argv.slice(2);
    const result = spawnSync(binPath, args, { stdio: "inherit" });
    process.exit(result.status !== null ? result.status : (result.error ? 1 : 0));
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
