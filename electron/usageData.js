const codexProvider = require("./providers/codex");
const claudeCodeProvider = require("./providers/claudeCode");

const PROVIDERS = [codexProvider, claudeCodeProvider];

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const dateFormatters = new Map();
const hourFormatters = new Map();

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

function emptyBucket() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0
  };
}

function accumulate(target, source) {
  target.inputTokens += source.inputTokens || 0;
  target.cachedInputTokens += source.cachedInputTokens || source.cacheReadTokens || 0;
  target.cacheReadTokens += source.cacheReadTokens || 0;
  target.cacheWriteTokens += source.cacheWriteTokens || 0;
  target.outputTokens += source.outputTokens || 0;
  target.totalTokens += source.totalTokens || 0;
  target.totalCost += source.totalCost || 0;
  return target;
}

function collectFromProviders(timezone) {
  const providerResults = PROVIDERS.map((provider) => provider.collect());
  const events = [];
  const modelUsage = new Map();
  let latestTimestamp = 0;

  for (const result of providerResults) {
    for (const event of result.events) {
      const date = new Date(event.timestampMs);
      const enriched = {
        ...event,
        dateKey: getDateKey(date, timezone),
        hourBucket: getHourBucket(date, timezone)
      };
      events.push(enriched);
      latestTimestamp = Math.max(latestTimestamp, enriched.timestampMs);

      if (!modelUsage.has(enriched.model)) {
        modelUsage.set(enriched.model, { ...emptyBucket(), provider: enriched.provider });
      }
      accumulate(modelUsage.get(enriched.model), enriched);
    }
  }

  return { providerResults, events, modelUsage, latestTimestamp };
}

function summarizeByDay(events) {
  const byDay = new Map();
  for (const event of events) {
    if (!byDay.has(event.dateKey)) byDay.set(event.dateKey, emptyBucket());
    accumulate(byDay.get(event.dateKey), event);
  }
  return byDay;
}

function summarizeModelUsage(modelUsageMap) {
  return [...modelUsageMap.entries()]
    .map(([model, usage]) => ({
      model,
      provider: usage.provider,
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
  const { providerResults, events, modelUsage, latestTimestamp } = collectFromProviders(timezone);
  const now = new Date();
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

  const trailing7Set = new Set(trailing7);
  const trailing30Set = new Set(trailing30);
  function bucketByProvider(filterFn) {
    const buckets = {};
    for (const event of events) {
      if (!filterFn(event)) continue;
      if (!buckets[event.provider]) buckets[event.provider] = emptyBucket();
      accumulate(buckets[event.provider], event);
    }
    return buckets;
  }
  const todayByProvider = bucketByProvider((e) => e.dateKey === todayKey);
  const sevenDayByProvider = bucketByProvider((e) => trailing7Set.has(e.dateKey));
  const thirtyDayByProvider = bucketByProvider((e) => trailing30Set.has(e.dateKey));

  const codexResult = providerResults.find((result) => result.provider === codexProvider.PROVIDER_ID);
  const totalFileCount = providerResults.reduce((sum, result) => sum + result.fileCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    latestEventAt: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
    timezone,
    dataSource: {
      sessionsRoot: codexResult?.root || codexProvider.SESSIONS_ROOT,
      fileCount: totalFileCount,
      eventCount: events.length,
      providers: providerResults.map((result) => ({
        provider: result.provider,
        root: result.root,
        fileCount: result.fileCount,
        eventCount: result.events.length
      }))
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
        deltaPercent: percentDelta(todayCurrent.totalTokens, todayPrevious.totalTokens),
        byProvider: todayByProvider
      },
      "7d": {
        key: "7d",
        label: "7 Days",
        inputTokens: sevenDayCurrent.inputTokens,
        cachedInputTokens: sevenDayCurrent.cachedInputTokens,
        outputTokens: sevenDayCurrent.outputTokens,
        totalTokens: sevenDayCurrent.totalTokens,
        totalCost: sevenDayCurrent.totalCost,
        deltaPercent: percentDelta(sevenDayCurrent.totalTokens, sevenDayPrevious.totalTokens),
        byProvider: sevenDayByProvider
      },
      "30d": {
        key: "30d",
        label: "30 Days",
        inputTokens: thirtyDayCurrent.inputTokens,
        cachedInputTokens: thirtyDayCurrent.cachedInputTokens,
        outputTokens: thirtyDayCurrent.outputTokens,
        totalTokens: thirtyDayCurrent.totalTokens,
        totalCost: thirtyDayCurrent.totalCost,
        deltaPercent: percentDelta(thirtyDayCurrent.totalTokens, thirtyDayPrevious.totalTokens),
        byProvider: thirtyDayByProvider
      }
    }
  };
}

module.exports = {
  buildSummary
};
