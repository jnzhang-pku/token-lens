const fs = require("fs");
const os = require("os");
const path = require("path");
const { estimateCost } = require("./pricing");

const PROVIDER_ID = "claude-code";
const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

function expandHome(inputPath) {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function getProjectsRoot() {
  const override = process.env.TOKENFETTI_CLAUDE_ROOT;
  return override ? expandHome(override) : DEFAULT_PROJECTS_ROOT;
}

function listSessionFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;

  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  files.sort();
  return files;
}

function readJsonlFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").split("\n");
  } catch {
    return [];
  }
}

function parseFile(filePath) {
  const events = [];
  const lines = readJsonlFile(filePath);

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "assistant" || !entry.message?.usage) continue;

    const usage = entry.message.usage;
    const baseInput = Number(usage.input_tokens || 0);
    const cacheWrite = Number(usage.cache_creation_input_tokens || 0);
    const cacheRead = Number(usage.cache_read_input_tokens || 0);
    const output = Number(usage.output_tokens || 0);

    // Real total input the API bills against. cache_creation / cache_read are
    // separate token populations charged at different rates.
    const inputTokens = baseInput + cacheWrite + cacheRead;
    const totalTokens = inputTokens + output;
    if (totalTokens <= 0) continue;

    const timestampMs = Date.parse(entry.timestamp || "");
    if (!Number.isFinite(timestampMs)) continue;

    const model = entry.message.model || "claude-unknown";
    const usageShape = {
      inputTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: output,
      totalTokens
    };

    events.push({
      timestampMs,
      provider: PROVIDER_ID,
      model,
      messageId: entry.message?.id || null,
      ...usageShape,
      cachedInputTokens: cacheRead,
      totalCost: estimateCost(usageShape, model)
    });
  }

  return events;
}

function collect() {
  const root = getProjectsRoot();
  const files = listSessionFiles(root);
  // Claude Code logs one row per content block (thinking, tool_use, text...)
  // and every row carries the SAME message.usage payload. Dedup by message.id
  // so a single API response is billed exactly once.
  const seenMessageIds = new Set();
  const events = [];
  for (const filePath of files) {
    for (const ev of parseFile(filePath)) {
      if (ev.messageId) {
        if (seenMessageIds.has(ev.messageId)) continue;
        seenMessageIds.add(ev.messageId);
      }
      events.push(ev);
    }
  }
  return {
    provider: PROVIDER_ID,
    root,
    fileCount: files.length,
    events
  };
}

module.exports = {
  PROVIDER_ID,
  DEFAULT_PROJECTS_ROOT,
  collect
};
