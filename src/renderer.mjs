const REFRESH_INTERVAL_MS = 60_000;
const RANGE_ORDER = ["today", "7d", "30d"];

const appRoot = document.getElementById("app-root");
const refreshButton = document.getElementById("refresh-button");
const updateStatus = document.getElementById("update-status");
function setOpen(open) {
  appRoot.classList.toggle("is-open", open);
}

window.tokenLensWidget?.onOpenState?.(setOpen);

function formatTokens(value) {
  const safeValue = Number(value) || 0;
  if (safeValue >= 1_000_000_000) return `${(safeValue / 1_000_000_000).toFixed(2)}B`;
  if (safeValue >= 100_000_000) return `${Math.round(safeValue / 1_000_000)}M`;
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(2)}M`;
  if (safeValue >= 1_000) return `${(safeValue / 1_000).toFixed(1)}K`;
  return `${Math.round(safeValue)}`;
}

function formatCost(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function updateMetrics(summary) {
  for (const rangeKey of RANGE_ORDER) {
    const range = summary?.ranges?.[rangeKey];
    const tokenNode = document.querySelector(`[data-range="${rangeKey}"][data-field="tokens"]`);
    const costNode = document.querySelector(`[data-range="${rangeKey}"][data-field="cost"]`);

    if (tokenNode) tokenNode.textContent = formatTokens(range?.totalTokens);
    if (costNode) costNode.textContent = formatCost(range?.totalCost);
  }
}

async function refreshSummary() {
  try {
    refreshButton?.classList.add("is-refreshing");
    if (updateStatus) updateStatus.textContent = "UPDATING";
    const summary = await window.tokenLensWidget?.getUsageSummary?.();
    updateMetrics(summary);
    if (updateStatus) updateStatus.textContent = "UPDATED NOW";
  } catch {
    updateMetrics(null);
    if (updateStatus) updateStatus.textContent = "UPDATE FAILED";
  } finally {
    refreshButton?.classList.remove("is-refreshing");
  }
}

refreshButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  refreshSummary();
});

refreshSummary();
window.setInterval(refreshSummary, REFRESH_INTERVAL_MS);
