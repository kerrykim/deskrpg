#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sync-lpc-assets.js — Download LPC walk-animation PNGs & generate registry
// ---------------------------------------------------------------------------
// Usage:  node scripts/sync-lpc-assets.js [--skip-download] [--registry-only]
//
// Phases:
//   A. Parse item-metadata.js (download from GitHub if missing)
//   B. Build download list (walk animations, male/female only)
//   C. Download PNGs via curl (skip existing, handle 404s)
//   D. Generate public/assets/lpc-registry.json
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const METADATA_PATH = "/tmp/lpc-metadata.js";
const METADATA_URL =
  "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/item-metadata.js";
const SPRITESHEET_BASE =
  "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/spritesheets/";
const LOCAL_SPRITESHEET_DIR = path.join(ROOT, "public", "assets", "spritesheets");
const REGISTRY_PATH = path.join(ROOT, "public", "assets", "lpc-registry.json");

const BODY_TYPES = ["male", "female"];

const SKIP_DOWNLOAD = process.argv.includes("--skip-download");
const REGISTRY_ONLY = process.argv.includes("--registry-only");

// ---------------------------------------------------------------------------
// Phase A: Parse metadata
// ---------------------------------------------------------------------------

function ensureMetadata() {
  if (!fs.existsSync(METADATA_PATH)) {
    console.log("Downloading item-metadata.js from GitHub...");
    execFileSync("curl", ["-fsSL", "-o", METADATA_PATH, METADATA_URL], {
      stdio: "inherit",
    });
  }
  console.log(`Reading metadata from ${METADATA_PATH}`);
  const src = fs.readFileSync(METADATA_PATH, "utf8");

  // Use vm to safely evaluate the JS (sets window.itemMetadata)
  const vm = require("vm");
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.itemMetadata;
}

// ---------------------------------------------------------------------------
// Phase B: Build download list
// ---------------------------------------------------------------------------

function buildDownloadList(metadata) {
  const files = [];

  for (const [key, item] of Object.entries(metadata)) {
    // Only items with walk animation
    if (!item.animations || !item.animations.includes("walk")) continue;

    for (const [layerName, layerObj] of Object.entries(item.layers)) {
      for (const bt of BODY_TYPES) {
        const layerPath = layerObj[bt];
        if (!layerPath) continue;

        // layerPath looks like "body/bodies/male/" — strip trailing slash
        const cleanPath = layerPath.replace(/\/+$/, "");

        for (const variant of item.variants) {
          const remotePath = `${cleanPath}/walk/${variant}.png`;
          const remoteUrl = SPRITESHEET_BASE + remotePath;
          const localPath = path.join(LOCAL_SPRITESHEET_DIR, remotePath);

          files.push({ remoteUrl, localPath, key, layerName, bt, variant });
        }
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Phase C: Download (parallel with concurrency control)
// ---------------------------------------------------------------------------

const CONCURRENCY = parseInt(process.env.DL_CONCURRENCY || "20", 10);

async function downloadFiles(files) {
  const total = files.length;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  // Filter out existing files first
  const toDownload = [];
  for (const f of files) {
    if (fs.existsSync(f.localPath)) {
      skipped++;
    } else {
      toDownload.push(f);
    }
  }

  console.log(
    `\nDownload list: ${total} total, ${skipped} already exist, ${toDownload.length} to download (concurrency=${CONCURRENCY})`,
  );

  if (toDownload.length === 0) return;

  // Ensure all directories exist upfront
  const dirs = new Set(toDownload.map((f) => path.dirname(f.localPath)));
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Download a single file
  const { execFile } = require("child_process");
  function downloadOne(file) {
    return new Promise((resolve) => {
      execFile(
        "curl",
        ["-fsSL", "--create-dirs", "-o", file.localPath, file.remoteUrl],
        { timeout: 30000 },
        (err) => {
          if (err) {
            try { fs.unlinkSync(file.localPath); } catch {}
            failed++;
          } else {
            downloaded++;
          }
          resolve();
        },
      );
    });
  }

  // Process in batches with concurrency
  let processed = 0;
  for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
    const batch = toDownload.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(downloadOne));
    processed += batch.length;

    // Progress report every batch
    if (processed % (CONCURRENCY * 5) === 0 || i + CONCURRENCY >= toDownload.length) {
      console.log(
        `  [${processed}/${toDownload.length}] downloaded=${downloaded} failed=${failed}`,
      );
    }
  }

  console.log(
    `\nDone: downloaded=${downloaded} skipped=${skipped} failed=${failed} total=${total}`,
  );
}

// ---------------------------------------------------------------------------
// Phase D: Generate registry JSON
// ---------------------------------------------------------------------------

function generateRegistry(metadata) {
  const categoryMap = new Map(); // type_name → items[]

  for (const [key, item] of Object.entries(metadata)) {
    if (!item.animations || !item.animations.includes("walk")) continue;

    const typeName = item.type_name;

    if (!categoryMap.has(typeName)) {
      categoryMap.set(typeName, []);
    }

    // Build layer info (only male/female)
    const layers = {};
    for (const [layerName, layerObj] of Object.entries(item.layers)) {
      const paths = {};
      for (const bt of BODY_TYPES) {
        if (layerObj[bt]) {
          paths[bt] = layerObj[bt].replace(/\/+$/, "");
        }
      }
      if (Object.keys(paths).length > 0) {
        layers[layerName] = {
          zPos: layerObj.zPos ?? 0,
          paths,
        };
      }
    }

    // Skip items with no male/female layers
    if (Object.keys(layers).length === 0) continue;

    categoryMap.get(typeName).push({
      key,
      name: item.name,
      type: typeName,
      variants: item.variants,
      layers,
      matchBodyColor: item.matchBodyColor || false,
      priority: item.priority,
    });
  }

  // Build categories array
  const categories = [];
  for (const [typeName, items] of categoryMap) {
    // Use the highest priority among items, or 50 as default
    const priorities = items.map((it) => it.priority).filter((p) => p != null);
    const categoryPriority =
      priorities.length > 0 ? Math.min(...priorities) : 50;

    // Capitalize label
    const label = typeName
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    categories.push({
      id: typeName,
      type_name: typeName,
      label,
      priority: categoryPriority,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // Sort categories by priority
  categories.sort((a, b) => a.priority - b.priority);

  const registry = {
    bodyTypes: BODY_TYPES,
    categories,
  };

  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`\nRegistry written to ${REGISTRY_PATH}`);
  console.log(
    `  ${categories.length} categories, ${categories.reduce((s, c) => s + c.items.length, 0)} items`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== LPC Asset Sync ===\n");

  const metadata = ensureMetadata();
  const keys = Object.keys(metadata);
  console.log(`Parsed ${keys.length} items from metadata`);

  if (!REGISTRY_ONLY && !SKIP_DOWNLOAD) {
    const files = buildDownloadList(metadata);
    await downloadFiles(files);
  } else {
    console.log("Skipping download phase");
  }

  generateRegistry(metadata);
  console.log("\n=== Done ===");
}

main();
