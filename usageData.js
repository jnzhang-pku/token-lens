const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_SESSION_SOURCES = [
  { id: "personal", label: "Personal", root: path.join(os.homedir(), ".codex", "sessions") },
  { id: "work", label: "Work", root: path.join(os.homedir(), ".codex-private", "sessions") }
];
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const PRICING_BY_MODEL = [
  { test: (model) => model.includes("5.5"), rates: { input: 5, cached: 0.5, output: 30 } },
  { test: (model) => model.includes("5-codex"), rates: { input: 1.25, cached: 0.125, output: 10 } },
  { test: (model) => model.includes("5.4-mini"), rates: { input: 0.75, cached: 0.075, output: 4.5 } },
  { test: (model) => model.includes("5.4"), rates: { input: 2.5, cached: 0.25, output: 15 } },
  { test: (model) => model.includes("5.3-codex"), rates: { input: 1.75, cached: 0.175, output: 14 } },
  { test: (model) => model.includes("5.2"), rates: { input: 1.75, cached: 0.175, output: 14 } },
  { test: () => true, rates: { input: 2.5, cached: 0.25, output: 15 } }
];

const dateFormatters = new Map();
const datePartFormatters = new Map();
const hourFormatters = new Map();

function expandHome(inputPath) {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function getSessionSources() {
  const rawSources = process.env.TOKEN_LENS_SESSION_SOURCES;
  if (!rawSources) return DEFAULT_SESSION_SOURCES;

  const roots = rawSources
    .split(path.delimiter)
    .map((sourcePath) => sourcePath.trim())
    .filter(Boolean);

  if (roots.length === 0) return DEFAULT_SESSION_SOURCES;

  return roots.map((root, index) => ({
    id: `source-${index + 1}`,
    label: `Source ${index + 1}`,
    root: expandHome(root)
  }));
}

function getDateFormatter(timezone) {
  if (!dateFormatters.has(timezone)) {
    dateFormatters.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      })
    );
  }
  return dateFormatters.get(timezone);
}

function getDatePartFormatter(timezone) {
  if (!datePartFormatters.has(timezone)) {
    datePartFormatters.set(
      timezone,
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      })
    );
  }
  return datePartFormatters.get(timezone);
}

function getHourFormatter(timezone) {
  if (!hourFormatters.has(timezone)) {
    hourFormatters.set(
      timezone,
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false
      })
    );
  }
  return hourFormatters.get(timezone);
}

function getDateKey(date, timezone) {
  return getDateFormatter(timezone).format(date);
}

function shiftDateKey(dateKey, offsetDays) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function getTrailingDateKeys(endDateKey, count) {
  return Array.from({ length: count }, (_value, index) => shiftDateKey(endDateKey, index - (count - 1)));
}

function getHourBucket(date, timezone) {
  const hour = Number(getHourFormatter(timezone).format(date));
  return Math.max(0, Math.min(7, Math.floor(hour / 3)));
}

function listSessionFiles(source) {
  const files = [];
  const rootDir = source.root;

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
        let stats = null;
        try {
          stats = fs.statSync(fullPath);
        } catch {
          continue;
        }
        files.push({
          path: fullPath,
          sourceId: source.id,
          sourceLabel: source.label,
          sourceRoot: rootDir,
          size: stats.size,
          mtimeMs: stats.mtimeMs
        });
      }
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function listSessionFilesFromSources(sources) {
  return sources.flatMap((source) => listSessionFiles(source));
}

function extractSessionIdFromFileName(filePath) {
  const match = path.basename(filePath).match(/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})\.jsonl$/i);
  return match?.[1] || filePath;
}

function readSessionMetadata(filePath) {
  const lines = readJsonlFile(filePath);
  for (const line of lines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "session_meta") continue;

    return {
      id: entry.payload?.id || extractSessionIdFromFileName(filePath),
      cwd: entry.payload?.cwd || null,
      timestamp: entry.payload?.timestamp || entry.timestamp || null
    };
  }

  return {
    id: extractSessionIdFromFileName(filePath),
    cwd: null,
    timestamp: null
  };
}

function compareSessionFiles(left, right) {
  if (left.size !== right.size) return left.size - right.size;
  if (left.mtimeMs !== right.mtimeMs) return left.mtimeMs - right.mtimeMs;
  return left.path.localeCompare(right.path);
}

function dedupeSessionFiles(files) {
  const bySessionId = new Map();

  for (const file of files) {
    const metadata = readSessionMetadata(file.path);
    const candidate = {
      ...file,
      sessionId: metadata.id,
      sessionCwd: metadata.cwd,
      sessionTimestamp: metadata.timestamp
    };
    const existing = bySessionId.get(candidate.sessionId);

    if (!existing || compareSessionFiles(existing, candidate) < 0) {
      bySessionId.set(candidate.sessionId, candidate);
    }
  }

  const dedupedFiles = [...bySessionId.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: dedupedFiles,
    duplicateCount: Math.max(0, files.length - dedupedFiles.length)
  };
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
  const cachedInputTokens = sanitizeDelta(currentTotals.cached_input_tokens, previousTotals?.cached_input_tokens);
  const outputTokens = sanitizeDelta(currentTotals.output_tokens, previousTotals?.output_tokens);
  const reasoningOutputTokens = sanitizeDelta(
    currentTotals.reasoning_output_tokens,
    previousTotals?.reasoning_output_tokens
  );
  const combinedOutputTokens = outputTokens + reasoningOutputTokens;
  const totalTokens = inputTokens + combinedOutputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens: combinedOutputTokens,
    rawOutputTokens: outputTokens,
    reasoningOutputTokens,
    totalTokens
  };
}

function getModelRates(model) {
  const normalized = String(model || "").toLowerCase();
  return PRICING_BY_MODEL.find((profile) => profile.test(normalized)).rates;
}

function estimateCost(usage, model) {
  const rates = getModelRates(model);
  const inputTokens = Number(usage.inputTokens || 0);
  const cachedInputTokens = Math.min(inputTokens, Number(usage.cachedInputTokens || 0));
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const inputCost = (uncachedInputTokens / 1_000_000) * rates.input;
  const cachedCost = (cachedInputTokens / 1_000_000) * rates.cached;
  const outputCost = ((usage.outputTokens || 0) / 1_000_000) * rates.output;
  return inputCost + cachedCost + outputCost;
}

function emptyBucket() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0
  };
}

function accumulate(target, source) {
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.outputTokens += source.outputTokens;
  target.totalTokens += source.totalTokens;
  target.totalCost += source.totalCost || 0;
  return target;
}

function parseUsageTimeline(timezone) {
  const sources = getSessionSources();
  const rawFiles = listSessionFilesFromSources(sources);
  const dedupeResult = dedupeSessionFiles(rawFiles);
  const files = dedupeResult.files;
  const events = [];
  const modelUsage = new Map();
  let latestTimestamp = 0;

  for (const file of files) {
    let previousTotals = null;
    let currentModel = "unknown";
    const lines = readJsonlFile(file.path);

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

      if (entry.type !== "event_msg" || entry.payload?.type !== "token_count" || !entry.payload?.info?.total_token_usage) {
        continue;
      }

      const totals = entry.payload.info.total_token_usage;
      const delta = normalizeUsageDelta(totals, previousTotals);
      previousTotals = totals;

      if (delta.totalTokens <= 0) continue;

      const timestampMs = Date.parse(entry.timestamp || "");
      if (!Number.isFinite(timestampMs)) continue;

      latestTimestamp = Math.max(latestTimestamp, timestampMs);
      events.push({
        timestampMs,
        dateKey: getDateKey(new Date(timestampMs), timezone),
        hourBucket: getHourBucket(new Date(timestampMs), timezone),
        model: currentModel,
        sourceId: file.sourceId,
        sourceLabel: file.sourceLabel,
        sessionId: file.sessionId,
        sessionCwd: file.sessionCwd,
        ...delta,
        totalCost: estimateCost(delta, currentModel)
      });

      if (!modelUsage.has(currentModel)) {
        modelUsage.set(currentModel, emptyBucket());
      }
      accumulate(modelUsage.get(currentModel), {
        ...delta,
        totalCost: estimateCost(delta, currentModel)
      });
    }
  }

  return {
    sources,
    rawFiles,
    files,
    duplicateCount: dedupeResult.duplicateCount,
    events,
    latestTimestamp,
    modelUsage
  };
}

function summarizeByDay(events) {
  const byDay = new Map();
  for (const event of events) {
    if (!byDay.has(event.dateKey)) {
      byDay.set(event.dateKey, emptyBucket());
    }
    accumulate(byDay.get(event.dateKey), event);
  }
  return byDay;
}

function summarizeModelUsage(modelUsageMap) {
  return [...modelUsageMap.entries()]
    .map(([model, usage]) => ({
      model,
      totalTokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      totalCost: usage.totalCost
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, 6);
}

function summarizeRange(byDay, dateKeys) {
  const total = emptyBucket();

  for (const key of dateKeys) {
    const bucket = byDay.get(key) || emptyBucket();
    accumulate(total, bucket);
  }

  return total;
}

function summarizeToday(events, todayKey) {
  const total = emptyBucket();

  for (const event of events) {
    if (event.dateKey !== todayKey) continue;
    accumulate(total, event);
  }

  return total;
}

function summarizeRangeFromEvents(events, dateKeys) {
  const total = emptyBucket();
  const dateKeySet = new Set(dateKeys);

  for (const event of events) {
    if (!dateKeySet.has(event.dateKey)) continue;
    accumulate(total, event);
  }

  return total;
}

function percentDelta(currentValue, previousValue) {
  if (previousValue <= 0) return 0;
  return ((currentValue - previousValue) / previousValue) * 100;
}

function buildSummary(timezone = DEFAULT_TIMEZONE) {
  const timeline = parseUsageTimeline(timezone);
  const { sources, rawFiles, events, files, duplicateCount, latestTimestamp, modelUsage } = timeline;
  const now = latestTimestamp ? new Date(latestTimestamp) : new Date();
  const todayKey = getDateKey(now, timezone);
  const trailing30 = getTrailingDateKeys(todayKey, 30);
  const previous30 = getTrailingDateKeys(shiftDateKey(todayKey, -30), 30);
  const trailing7 = trailing30.slice(-7);
  const previous7 = trailing30.slice(-14, -7);
  const byDay = summarizeByDay(events);

  const todayCurrent = summarizeToday(events, todayKey);
  const todayPrevious = summarizeRange(byDay, [shiftDateKey(todayKey, -1)]);
  const sevenDayCurrent = summarizeRangeFromEvents(events, trailing7);
  const sevenDayPrevious = summarizeRange(byDay, previous7);
  const thirtyDayCurrent = summarizeRangeFromEvents(events, trailing30);
  const thirtyDayPrevious = summarizeRange(byDay, previous30);

  return {
    generatedAt: new Date().toISOString(),
    latestEventAt: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
    timezone,
    dataSource: {
      sessionSources: sources.map((source) => ({
        id: source.id,
        label: source.label,
        root: source.root,
        exists: fs.existsSync(source.root),
        rawFileCount: rawFiles.filter((file) => file.sourceId === source.id).length,
        selectedFileCount: files.filter((file) => file.sourceId === source.id).length
      })),
      rawFileCount: rawFiles.length,
      fileCount: files.length,
      duplicateFileCount: duplicateCount,
      eventCount: events.length
    },
    models: summarizeModelUsage(modelUsage),
    ranges: {
      today: {
        key: "today",
        label: "Today",
        inputTokens: todayCurrent.inputTokens,
        cachedInputTokens: todayCurrent.cachedInputTokens,
        outputTokens: todayCurrent.outputTokens,
        totalTokens: todayCurrent.totalTokens,
        totalCost: todayCurrent.totalCost,
        deltaPercent: percentDelta(todayCurrent.totalTokens, todayPrevious.totalTokens)
      },
      "7d": {
        key: "7d",
        label: "7 Days",
        inputTokens: sevenDayCurrent.inputTokens,
        cachedInputTokens: sevenDayCurrent.cachedInputTokens,
        outputTokens: sevenDayCurrent.outputTokens,
        totalTokens: sevenDayCurrent.totalTokens,
        totalCost: sevenDayCurrent.totalCost,
        deltaPercent: percentDelta(sevenDayCurrent.totalTokens, sevenDayPrevious.totalTokens)
      },
      "30d": {
        key: "30d",
        label: "30 Days",
        inputTokens: thirtyDayCurrent.inputTokens,
        cachedInputTokens: thirtyDayCurrent.cachedInputTokens,
        outputTokens: thirtyDayCurrent.outputTokens,
        totalTokens: thirtyDayCurrent.totalTokens,
        totalCost: thirtyDayCurrent.totalCost,
        deltaPercent: percentDelta(thirtyDayCurrent.totalTokens, thirtyDayPrevious.totalTokens)
      }
    }
  };
}

module.exports = {
  buildSummary
};
