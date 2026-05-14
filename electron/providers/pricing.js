// USD per 1M tokens. Match order matters: more specific patterns first.
// Each entry uses a unified rate shape so different providers can flow through
// the same estimator:
//   input      uncached input rate
//   cacheRead  cache-hit rate (Codex's old "cached" rate maps here)
//   output     output rate

const PRICING_BY_MODEL = [
  { test: (model) => model.includes("5.5"), rates: { input: 5, cacheRead: 0.5, output: 30 } },
  { test: (model) => model.includes("5-codex"), rates: { input: 1.25, cacheRead: 0.125, output: 10 } },
  { test: (model) => model.includes("5.4-mini"), rates: { input: 0.75, cacheRead: 0.075, output: 4.5 } },
  { test: (model) => model.includes("5.4"), rates: { input: 2.5, cacheRead: 0.25, output: 15 } },
  { test: (model) => model.includes("5.3-codex"), rates: { input: 1.75, cacheRead: 0.175, output: 14 } },
  { test: (model) => model.includes("5.2"), rates: { input: 1.75, cacheRead: 0.175, output: 14 } },
  { test: () => true, rates: { input: 2.5, cacheRead: 0.25, output: 15 } }
];

function getModelRates(model) {
  const normalized = String(model || "").toLowerCase();
  return PRICING_BY_MODEL.find((profile) => profile.test(normalized)).rates;
}

function estimateCost(usage, model) {
  const rates = getModelRates(model);
  const inputTokens = Number(usage.inputTokens || 0);
  const cacheReadTokens = Math.min(inputTokens, Number(usage.cacheReadTokens ?? usage.cachedInputTokens ?? 0));
  const cacheWriteTokens = Math.max(0, Number(usage.cacheWriteTokens || 0));
  const uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
  const outputTokens = Math.max(0, Number(usage.outputTokens || 0));

  const inputCost = (uncachedInputTokens / 1_000_000) * rates.input;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (rates.cacheWrite ?? rates.input);
  const cacheReadCost = (cacheReadTokens / 1_000_000) * rates.cacheRead;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return inputCost + cacheWriteCost + cacheReadCost + outputCost;
}

module.exports = {
  getModelRates,
  estimateCost
};
