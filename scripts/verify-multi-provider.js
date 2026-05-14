// Verifies that Codex + Claude events flow through the same buildSummary
// and produce a merged today/7d/30d view. Uses TOKEN_LENS_CLAUDE_ROOT for
// the Claude side; Codex side runs against real ~/.codex/sessions, so this
// asserts only on per-provider stats and the Claude side.

const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-multi-"));
const claudeRoot = path.join(tmpDir, "projects", "-Users-test-app");
fs.mkdirSync(claudeRoot, { recursive: true });

const claudeSessionId = "55555555-5555-5555-5555-555555555555";
fs.writeFileSync(
  path.join(claudeRoot, `${claudeSessionId}.jsonl`),
  `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-05-14T01:00:00.000Z",
    sessionId: claudeSessionId,
    cwd: "/Users/test/app",
    message: {
      model: "claude-sonnet-4-6",
      role: "assistant",
      usage: { input_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 30, output_tokens: 25 }
    }
  })}\n`
);

process.env.TOKEN_LENS_CLAUDE_ROOT = path.join(tmpDir, "projects");

const { buildSummary } = require("../electron/usageData");
const summary = buildSummary("UTC");

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const providerStats = Object.fromEntries(summary.dataSource.providers.map((entry) => [entry.provider, entry]));

if (!providerStats.codex) throw new Error("codex provider missing from summary");
if (!providerStats["claude-code"]) throw new Error("claude-code provider missing from summary");

assertEqual(providerStats["claude-code"].fileCount, 1, "claude.fileCount");
assertEqual(providerStats["claude-code"].eventCount, 1, "claude.eventCount");

const claudeModel = summary.models.find((entry) => entry.provider === "claude-code");
if (!claudeModel) throw new Error("expected at least one claude-code model in models[]");
assertEqual(claudeModel.model, "claude-sonnet-4-6", "claudeModel.model");

console.log(
  JSON.stringify(
    {
      ok: true,
      providers: providerStats,
      claudeModel,
      todayTotalCost: summary.ranges.today.totalCost
    },
    null,
    2
  )
);
