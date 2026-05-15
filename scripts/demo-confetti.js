// Fakes a Codex session that bumps today's cost by a target USD amount.
// Next Tokenfetti refresh detects the jump and fires confetti.
//
// Usage:
//   node scripts/demo-confetti.js [usdAmount]
//
// Default $50 is enough to cross the daily-plan threshold (BIG burst, footer
// flashes gold) if you haven't yet, or to cross at least the $25/$50 milestone
// otherwise (MEDIUM burst).
//
// Cleanup any demo files with:
//   find ~/.codex/sessions -name "rollout-DEMO-*.jsonl" -delete

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const targetUsd = Number(process.argv[2]) || 50;

// GPT-5.4 output rate is $15/1M tokens.
const outputTokens = Math.round((targetUsd / 15) * 1_000_000);

const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, "0");
const dd = String(now.getDate()).padStart(2, "0");
const dirPath = path.join(os.homedir(), ".codex", "sessions", String(yyyy), mm, dd);
fs.mkdirSync(dirPath, { recursive: true });

const sessionId = crypto.randomUUID();
const stamp = now.toISOString().replace(/\..*$/, "").replace(/[:T]/g, "-");
const filePath = path.join(dirPath, `rollout-DEMO-${stamp}-${sessionId}.jsonl`);

const isoNow = now.toISOString();
const isoPlus = new Date(now.getTime() + 1000).toISOString();

const lines = [
  {
    type: "session_meta",
    timestamp: isoNow,
    payload: { id: sessionId, cwd: "/tmp/tokenfetti-demo", timestamp: isoNow }
  },
  {
    type: "turn_context",
    timestamp: isoNow,
    payload: { model: "gpt-5.4" }
  },
  {
    type: "event_msg",
    timestamp: isoPlus,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: outputTokens,
          reasoning_output_tokens: 0
        }
      }
    }
  }
];

fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

console.log(`Wrote: ${filePath}`);
console.log(`Adds ~$${targetUsd.toFixed(2)} (${outputTokens.toLocaleString()} GPT-5.4 output tokens) to today.`);
console.log(`Now click the refresh button in Tokenfetti, or wait <=60s.`);
console.log(`Cleanup: rm "${filePath}"`);
