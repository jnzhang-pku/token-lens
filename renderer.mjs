import React, { useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { AnimatePresence, motion } from "https://esm.sh/framer-motion@11.3.19?bundle";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const CLOSE_DELAY_MS = 350;

const METRICS = [
  { label: "TODAY", tokens: "31.93M", cost: "$56.46" },
  { label: "7 DAYS", tokens: "258M", cost: "$446.64" },
  { label: "30 DAYS", tokens: "1.51B", cost: "$2,704.95" }
];

const PANEL_TRANSITION = {
  type: "spring",
  stiffness: 420,
  damping: 36,
  mass: 0.7
};

function MetricColumn({ metric }) {
  return html`
    <div className="metric-column">
      <div className="metric-label">${metric.label}</div>
      <div className="metric-value">${metric.tokens}</div>
      <div className="metric-cost">${metric.cost}</div>
    </div>
  `;
}

function App() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  const handleMouseEnter = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };

  const handleMouseLeave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return html`
    <main className="app-root" onMouseEnter=${handleMouseEnter} onMouseLeave=${handleMouseLeave}>
      <div className="hover-zone" aria-hidden="true"></div>

      ${!open &&
      html`
        <div className="handle" aria-hidden="true">
          <div className="handle-mark"></div>
        </div>
      `}

      <${AnimatePresence}>
        ${open &&
        html`
          <motion.section
            key="panel"
            className="panel"
            initial=${{ opacity: 0, y: -16, scale: 0.96 }}
            animate=${{ opacity: 1, y: 0, scale: 1 }}
            exit=${{ opacity: 0, y: -12, scale: 0.98 }}
            transition=${PANEL_TRANSITION}
          >
            <header className="panel-header">
              <span className="panel-title">TOKEN LENS</span>
              <span className="panel-model">GPT-5.4</span>
            </header>

            <section className="metrics-row" aria-label="Token usage summary">
              ${METRICS.map((metric) => html`<${MetricColumn} key=${metric.label} metric=${metric} />`)}
            </section>

            <footer className="panel-footer">
              <span>LOCAL CODEX USAGE</span>
              <span>UPDATED NOW</span>
            </footer>
          </motion.section>
        `}
      <//>
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
