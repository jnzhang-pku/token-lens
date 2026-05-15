// Verifies the Claude Code parser against a synthetic session file.
// Usage: npm run verify:claude-parser

const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenfetti-claude-parser-"));
const claudeRoot = path.join(tmpDir, "projects", "-Users-test-app");
fs.mkdirSync(claudeRoot, { recursive: true });

const sessionId = "11111111-1111-1111-1111-111111111111";
const filePath = path.join(claudeRoot, `${sessionId}.jsonl`);

function assistantRow(timestamp, model, usage) {
  return {
    type: "assistant",
    timestamp,
    sessionId,
    cwd: "/Users/test/app",
    message: { model, role: "assistant", usage }
  };
}

const rows = [
  { type: "user", timestamp: "2026-05-14T00:00:00.000Z", sessionId, message: { role: "user", content: "hi" } },
  assistantRow("2026-05-14T00:00:01.000Z", "claude-opus-4-7", {
    input_tokens: 100,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 300,
    output_tokens: 50
  }),
  assistantRow("2026-05-14T00:00:02.000Z", "claude-sonnet-4-6", {
    input_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 5
  })
];

fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

process.env.TOKENFETTI_CLAUDE_ROOT = path.join(tmpDir, "projects");

const { buildSummary } = require("../electron/usageData");
const summary = buildSummary("UTC");

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual} (delta ${Math.abs(actual - expected)})`);
  }
}

const claudeStats = summary.dataSource.providers.find((entry) => entry.provider === "claude-code");
if (!claudeStats) throw new Error("claude-code provider stats missing");

assertEqual(claudeStats.fileCount, 1, "claude.fileCount");
assertEqual(claudeStats.eventCount, 2, "claude.eventCount (only assistant rows with usage)");

// Tokens:
//   Opus row : 100 + 200 + 300 input, 50 output -> 650 total
//   Sonnet   : 10 input, 5 output -> 15 total
// (today.totalTokens may include stray Codex events from real ~/.codex; assert
// the per-provider claude eventCount instead.)

// Cost expectations on the Claude side only:
//   Opus 4.7  : in $5 / cwrite $6.25 / cread $0.50 / out $25
//   Sonnet 4.6: in $3 / out $15
const opusCost =
  (100 / 1_000_000) * 5 + (200 / 1_000_000) * 6.25 + (300 / 1_000_000) * 0.5 + (50 / 1_000_000) * 25;
const sonnetCost = (10 / 1_000_000) * 3 + (5 / 1_000_000) * 15;
const opusModel = summary.models.find((entry) => entry.model === "claude-opus-4-7");
const sonnetModel = summary.models.find((entry) => entry.model === "claude-sonnet-4-6");
if (!opusModel || !sonnetModel) throw new Error("expected both Claude models in models[]");
assertClose(opusModel.totalCost, opusCost, "opus.totalCost");
assertClose(sonnetModel.totalCost, sonnetCost, "sonnet.totalCost");

console.log(JSON.stringify({ ok: true, claude: claudeStats, opusCost: opusModel.totalCost, sonnetCost: sonnetModel.totalCost }, null, 2));
