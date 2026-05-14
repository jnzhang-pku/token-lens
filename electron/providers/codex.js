const fs = require("fs");
const os = require("os");
const path = require("path");
const { estimateCost } = require("./pricing");

const PROVIDER_ID = "codex";
const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

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
      } else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
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

function sanitizeDelta(currentValue, previousValue) {
  return Math.max(0, Number(currentValue || 0) - Number(previousValue || 0));
}

function normalizeUsageDelta(currentTotals, previousTotals) {
  const inputTokens = sanitizeDelta(currentTotals.input_tokens, previousTotals?.input_tokens);
  const cacheReadTokens = sanitizeDelta(currentTotals.cached_input_tokens, previousTotals?.cached_input_tokens);
  const outputTokens = sanitizeDelta(currentTotals.output_tokens, previousTotals?.output_tokens);
  const reasoningOutputTokens = sanitizeDelta(
    currentTotals.reasoning_output_tokens,
    previousTotals?.reasoning_output_tokens
  );
  const combinedOutputTokens = outputTokens + reasoningOutputTokens;
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    outputTokens: combinedOutputTokens,
    rawOutputTokens: outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + combinedOutputTokens
  };
}

function parseFile(filePath) {
  const events = [];
  const lines = readJsonlFile(filePath);
  let previousTotals = null;
  let currentModel = "unknown";

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "turn_context" && entry.payload?.model) {
      currentModel = entry.payload.model;
    }

    if (
      entry.type !== "event_msg" ||
      entry.payload?.type !== "token_count" ||
      !entry.payload?.info?.total_token_usage
    ) {
      continue;
    }

    const totals = entry.payload.info.total_token_usage;
    const delta = normalizeUsageDelta(totals, previousTotals);
    previousTotals = totals;

    if (delta.totalTokens <= 0) continue;

    const timestampMs = Date.parse(entry.timestamp || "");
    if (!Number.isFinite(timestampMs)) continue;

    events.push({
      timestampMs,
      provider: PROVIDER_ID,
      model: currentModel,
      ...delta,
      // Back-compat alias for callers reading cachedInputTokens
      cachedInputTokens: delta.cacheReadTokens,
      totalCost: estimateCost(delta, currentModel)
    });
  }

  return events;
}

function collect() {
  const files = listSessionFiles(SESSIONS_ROOT);
  const events = files.flatMap((filePath) => parseFile(filePath));
  return {
    provider: PROVIDER_ID,
    root: SESSIONS_ROOT,
    fileCount: files.length,
    events
  };
}

module.exports = {
  PROVIDER_ID,
  SESSIONS_ROOT,
  collect
};
