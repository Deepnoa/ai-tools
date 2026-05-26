import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOT = "/mnt/nas";
const DEFAULT_MANIFEST_PATH = "registry/indexes/rag-safe-index-cards.jsonl";

function toJsonResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

function readConfig(api) {
  const cfg = api.pluginConfig ?? {};
  return {
    root: typeof cfg.root === "string" && cfg.root.trim() ? cfg.root.trim() : DEFAULT_ROOT,
    manifestPath:
      typeof cfg.manifestPath === "string" && cfg.manifestPath.trim()
        ? cfg.manifestPath.trim().replace(/^\/+/, "")
        : DEFAULT_MANIFEST_PATH,
  };
}

function resolveInsideRoot(root, relPath) {
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, relPath);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error(`path escapes NAS root: ${relPath}`);
  }
  return abs;
}

async function readManifestHealth(api) {
  const cfg = readConfig(api);
  const manifestPath = resolveInsideRoot(cfg.root, cfg.manifestPath);
  const result = {
    manifest_path: manifestPath,
    manifest_read_ok: false,
    entry_count: 0,
    jsonl_valid: false,
    invalid_line_count: 0,
    first_invalid_line: null,
    raw_ingest_allowed_violations: 0,
    source_refs_followed: false,
    raw_files_read: false,
    recursive_scan: false,
    embeddings: false,
    trusted_canonical_mutation: false,
  };

  const text = await fs.readFile(manifestPath, "utf8");
  result.manifest_read_ok = true;
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    result.entry_count += 1;
    try {
      const item = JSON.parse(line);
      if (item.raw_ingest_allowed !== false) {
        result.raw_ingest_allowed_violations += 1;
      }
    } catch {
      result.invalid_line_count += 1;
      result.first_invalid_line ??= index + 1;
    }
  }
  result.jsonl_valid = result.invalid_line_count === 0;
  return result;
}

const plugin = {
  id: "nas-manifest-health",
  name: "NAS Manifest Health",
  description: "Read-only proof tool for the Deepnoa rag-safe NAS manifest.",
  register(api) {
    api.registerTool(
      {
        name: "nas_manifest_health",
        label: "NAS Manifest Health",
        description:
          "Read only /mnt/nas/registry/indexes/rag-safe-index-cards.jsonl and return bounded health metadata.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        async execute() {
          return toJsonResult(await readManifestHealth(api));
        },
      },
      { optional: true },
    );
  },
};

export default plugin;
