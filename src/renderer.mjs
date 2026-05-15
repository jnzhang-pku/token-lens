const REFRESH_INTERVAL_MS = 60_000;
const RANGE_ORDER = ["today", "7d", "30d"];

const SMALL_BURST_USD = 5;
const COST_MILESTONES = [25, 50, 100, 250, 500, 1000, 2500, 5000];
const COST_TIER_THRESHOLDS = [5, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const TICK_DURATION_MS = 600;

const CONFETTI_COLORS = ["#8b6cff", "#a08aff", "#ffd584", "#ffb547", "#ffffff"];
const INTENSITY_RANK = { small: 1, medium: 2, big: 3 };

const appRoot = document.getElementById("app-root");
const refreshButton = document.getElementById("refresh-button");
const confettiCanvas = document.getElementById("confetti-canvas");
const ctx = confettiCanvas.getContext("2d");

let panelOpen = false;
let previousSummary = null;
let inflightRefreshes = 0;
let firedCostMilestones = { day: null, set: new Set() };
let pendingCelebrationIntensity = null;

const activeTweens = new Map();

function setOpen(open) {
  panelOpen = open;
  appRoot.classList.toggle("is-open", open);
  if (open) {
    resizeCanvas();
    drainPendingCelebration();
  }
}

window.tokenfettiWidget?.onOpenState?.(setOpen);

function formatTokens(value) {
  const safeValue = Number(value) || 0;
  if (safeValue >= 1_000_000_000) return `${(safeValue / 1_000_000_000).toFixed(2)}B`;
  if (safeValue >= 100_000_000) return `${Math.round(safeValue / 1_000_000)}M`;
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(2)}M`;
  if (safeValue >= 1_000) return `${(safeValue / 1_000).toFixed(1)}K`;
  return `${Math.round(safeValue)}`;
}

function formatCostCompact(value) {
  const v = Number(value) || 0;
  if (v === 0) return "$0";
  if (v < 10) return `$${v.toFixed(2)}`;
  if (v < 10_000) return `$${Math.round(v).toLocaleString()}`;
  if (v < 1_000_000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${(v / 1_000_000).toFixed(2)}M`;
}

function costTierClass(cost) {
  const v = Number(cost) || 0;
  if (v === 0) return "is-cost-tier-0";
  let crossed = 0;
  for (const threshold of COST_TIER_THRESHOLDS) {
    if (v >= threshold) crossed++;
    else break;
  }
  return `is-cost-tier-${crossed + 1}`;
}

function applyCostTier(node, cost) {
  if (!node) return;
  for (const cls of [...node.classList]) {
    if (cls.startsWith("is-cost-tier-")) node.classList.remove(cls);
  }
  node.classList.add(costTierClass(cost));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function tween(node, formatter, toValue) {
  if (!node) return;
  const fromValue = Number(node.dataset.prev || 0);
  const target = Number(toValue) || 0;
  node.dataset.prev = String(target);

  const prevRaf = activeTweens.get(node);
  if (prevRaf) {
    cancelAnimationFrame(prevRaf);
    activeTweens.delete(node);
  }

  if (!panelOpen || Math.abs(target - fromValue) < 0.001) {
    node.textContent = formatter(target);
    return;
  }

  const startedAt = performance.now();
  function step(now) {
    const elapsed = now - startedAt;
    const t = Math.min(1, elapsed / TICK_DURATION_MS);
    const eased = easeOutCubic(t);
    const current = fromValue + (target - fromValue) * eased;
    node.textContent = formatter(current);
    if (t < 1) {
      activeTweens.set(node, requestAnimationFrame(step));
    } else {
      activeTweens.delete(node);
    }
  }
  activeTweens.set(node, requestAnimationFrame(step));
}

function localDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let particles = [];
let confettiRafId = 0;

function resizeCanvas() {
  const rect = confettiCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  confettiCanvas.width = Math.round(rect.width * dpr);
  confettiCanvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function intensityCount(intensity) {
  if (intensity === "big") return 60;
  if (intensity === "medium") return 36;
  return 18;
}

function intensitySpeed(intensity) {
  if (intensity === "big") return { spread: 1.6, base: 4, jitter: 5 };
  if (intensity === "medium") return { spread: 1.3, base: 3.2, jitter: 4 };
  return { spread: 1.0, base: 2.5, jitter: 3 };
}

function spawnConfetti(originX, originY, intensity) {
  const count = intensityCount(intensity);
  const { spread, base, jitter } = intensitySpeed(intensity);
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = base + Math.random() * jitter;
    particles.push({
      x: originX + (Math.random() - 0.5) * 24,
      y: originY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.5,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.4,
      width: 3 + Math.random() * 3,
      height: 6 + Math.random() * 4,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      life: 0,
      maxLife: 1100 + Math.random() * 400
    });
  }
  if (!confettiRafId) {
    let lastTime = performance.now();
    function loop(now) {
      const dt = Math.min(40, now - lastTime);
      lastTime = now;
      const w = confettiCanvas.clientWidth;
      const h = confettiCanvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const frameScale = dt / 16.67;
      for (const p of particles) {
        p.life += dt;
        p.vy += 0.18 * frameScale;
        p.vx *= 0.995;
        p.x += p.vx * frameScale;
        p.y += p.vy * frameScale;
        p.rot += p.vrot * frameScale;
        const lifeRatio = p.life / p.maxLife;
        const alpha = Math.max(0, 1 - Math.pow(lifeRatio, 2.5));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        ctx.restore();
      }
      particles = particles.filter((p) => p.life < p.maxLife && p.y < h + 20);
      if (particles.length > 0) {
        confettiRafId = requestAnimationFrame(loop);
      } else {
        ctx.clearRect(0, 0, w, h);
        confettiRafId = 0;
      }
    }
    confettiRafId = requestAnimationFrame(loop);
  }
}

function celebrateAtMetric(rangeKey, intensity) {
  if (!panelOpen) {
    if (
      !pendingCelebrationIntensity ||
      INTENSITY_RANK[intensity] > INTENSITY_RANK[pendingCelebrationIntensity]
    ) {
      pendingCelebrationIntensity = intensity;
    }
    return;
  }
  const node = document.querySelector(`[data-range="${rangeKey}"][data-field="cost"]`);
  if (!node) return;
  const nodeRect = node.getBoundingClientRect();
  const canvasRect = confettiCanvas.getBoundingClientRect();
  const x = nodeRect.left + nodeRect.width / 2 - canvasRect.left;
  const y = nodeRect.top + nodeRect.height * 0.4 - canvasRect.top;
  spawnConfetti(x, y, intensity);
  if (intensity === "big") {
    node.classList.add("is-celebrating");
    setTimeout(() => node.classList.remove("is-celebrating"), 1600);
  }
}

function drainPendingCelebration() {
  if (!pendingCelebrationIntensity) return;
  const intensity = pendingCelebrationIntensity;
  pendingCelebrationIntensity = null;
  setTimeout(() => celebrateAtMetric("today", intensity), 320);
}

function detectMilestones(prev, next) {
  if (!prev || !next) return;
  const prevToday = prev?.ranges?.today;
  const nextToday = next?.ranges?.today;
  if (!nextToday) return;

  const today = localDayKey();
  if (firedCostMilestones.day !== today) {
    firedCostMilestones = { day: today, set: new Set() };
  }

  const prevCost = Number(prevToday?.totalCost || 0);
  const nextCost = Number(nextToday?.totalCost || 0);

  let highestCrossed = null;
  for (const m of COST_MILESTONES) {
    if (prevCost < m && nextCost >= m && !firedCostMilestones.set.has(m)) {
      firedCostMilestones.set.add(m);
      highestCrossed = m;
    }
  }
  if (highestCrossed !== null) {
    celebrateAtMetric("today", highestCrossed >= 250 ? "big" : "medium");
    return;
  }

  if (nextCost - prevCost >= SMALL_BURST_USD) {
    celebrateAtMetric("today", "small");
  }
}

const PROVIDER_IDS = ["codex", "claude-code"];

function updateProviderTooltip(rangeKey, byProvider) {
  const tooltip = document.querySelector(`.metric-tooltip[data-range="${rangeKey}"]`);
  if (!tooltip) return;
  for (const providerId of PROVIDER_IDS) {
    const node = tooltip.querySelector(`.tt-value[data-provider="${providerId}"]`);
    if (!node) continue;
    const cost = byProvider?.[providerId]?.totalCost || 0;
    node.textContent = formatCostCompact(cost);
  }
}

function positionTooltipNextToCost(costNode, tip) {
  if (!costNode || !tip) return;
  const range = document.createRange();
  range.selectNodeContents(costNode);
  const textRect = range.getBoundingClientRect();
  range.detach?.();
  const rootRect = appRoot.getBoundingClientRect();
  const left = textRect.right - rootRect.left + 6;
  tip.style.left = `${left}px`;
}

const tooltipHideTimers = new Map();
for (const col of document.querySelectorAll(".metric-column[data-column-range]")) {
  const rangeKey = col.dataset.columnRange;
  const tip = document.querySelector(`.metric-tooltip[data-range="${rangeKey}"]`);
  const costNode = col.querySelector('[data-field="cost"]');
  if (!tip) continue;
  col.addEventListener("mouseenter", () => {
    const t = tooltipHideTimers.get(tip);
    if (t) clearTimeout(t);
    tooltipHideTimers.delete(tip);
    positionTooltipNextToCost(costNode, tip);
    tip.classList.add("is-visible");
  });
  col.addEventListener("mouseleave", () => {
    const t = setTimeout(() => {
      tip.classList.remove("is-visible");
      tooltipHideTimers.delete(tip);
    }, 200);
    tooltipHideTimers.set(tip, t);
  });
}

function updateMetrics(summary) {
  for (const rangeKey of RANGE_ORDER) {
    const range = summary?.ranges?.[rangeKey];
    const costNode = document.querySelector(`[data-range="${rangeKey}"][data-field="cost"]`);
    const tokenNode = document.querySelector(`[data-range="${rangeKey}"][data-field="tokens"]`);
    applyCostTier(costNode, range?.totalCost);
    tween(costNode, formatCostCompact, range?.totalCost);
    tween(tokenNode, formatTokens, range?.totalTokens);
    updateProviderTooltip(rangeKey, range?.byProvider);
  }
}

async function refreshSummary() {
  inflightRefreshes++;
  refreshButton?.classList.remove("has-error");
  refreshButton?.classList.add("is-refreshing");
  try {
    const summary = await window.tokenfettiWidget?.getUsageSummary?.();
    updateMetrics(summary);
    detectMilestones(previousSummary, summary);
    previousSummary = summary;
  } catch {
    updateMetrics(null);
    refreshButton?.classList.add("has-error");
    setTimeout(() => refreshButton?.classList.remove("has-error"), 1500);
  } finally {
    inflightRefreshes--;
    if (inflightRefreshes <= 0) {
      inflightRefreshes = 0;
      refreshButton?.classList.remove("is-refreshing");
    }
  }
}

refreshButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  refreshSummary();
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

refreshSummary();
window.setInterval(refreshSummary, REFRESH_INTERVAL_MS);
