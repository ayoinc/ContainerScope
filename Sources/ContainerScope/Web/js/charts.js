"use strict";
/*
  Time-series line chart following HIG Charts guidance:
  common line marks, descriptive title + summary, fixed axis for percentages and
  "nice" dynamic bounds for bytes, sparse gridlines, values never conveyed by color alone
  (legend repeats each series' current value in text), and an accessible label.
*/
CS.WINDOW_MS = 3 * 60 * 1000;

CS.niceMax = function niceMax(value) {
  if (!(value > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  // Familiar sequences whose halves stay readable (HIG Charts: prefer familiar tick values).
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (value <= step * exp) return step * exp;
  return 10 * exp;
};

CS.LineChart = class LineChart {
  /**
   * @param {object} o
   * @param {string} o.title
   * @param {{key:string,label:string,color:string}[]} o.series
   * @param {(v:number)=>string} o.format   value formatter for legend/summary
   * @param {(v:number)=>string} [o.axis]   tick formatter (defaults to format)
   * @param {number} [o.max]                fixed upper bound; omit for dynamic
   * @param {number} [o.floor]              smallest dynamic upper bound, so idle charts keep sane ticks
   * @param {number} [o.height]
   */
  constructor(o) {
    Object.assign(this, { height: 132, axis: o.format }, o);
    this.uid = CS.LineChart.count = (CS.LineChart.count || 0) + 1;
    this.samples = [];
    this.summaryEl = CS.h("span", { class: "chart-summary" });
    this.legendEl = CS.h("div", { class: "chart-legend" });
    this.svg = CS.h("svg", { role: "img", height: this.height });
    this.el = CS.h("figure", { class: "chart group", style: { margin: 0 } },
      CS.h("figcaption", { class: "chart-head" }, CS.h("span", { class: "chart-title" }, this.title), this.summaryEl, this.legendEl),
      this.svg);
    this.resize = new ResizeObserver(() => this.render());
    this.resize.observe(this.el);
  }

  update(samples) {
    this.samples = samples;
    this.render();
  }

  render() {
    const width = this.svg.clientWidth || this.el.clientWidth - 32;
    if (width <= 0) return;
    const height = this.height;
    const axisWidth = 46;
    const plotW = width - axisWidth;
    const top = 6, bottom = height - 4, plotH = bottom - top;
    const now = this.samples.length ? this.samples[this.samples.length - 1].t : Date.now();
    const start = now - CS.WINDOW_MS;
    const visible = this.samples.filter((s) => s.t >= start);

    const dataMax = Math.max(0, ...visible.flatMap((s) => this.series.map((ser) => s[ser.key] || 0)));
    const max = this.max ?? CS.niceMax(Math.max(dataMax * 1.1, this.floor || 0));
    const x = (t) => ((t - start) / CS.WINDOW_MS) * plotW;
    const y = (v) => bottom - (Math.min(v, max) / max) * plotH;

    const h = CS.h;
    const nodes = [];
    for (const f of [0, 0.5, 1]) {
      const gy = Math.round(y(max * f)) + 0.5;
      nodes.push(h("line", { class: f === 0 ? "baseline" : "gridline", x1: 0, x2: plotW, y1: gy, y2: gy }));
      nodes.push(h("text", { class: "tick", x: plotW + 8, y: gy + 3.5, "aria-hidden": "true" }, this.axis(max * f)));
    }

    const latest = visible[visible.length - 1];
    if (visible.length < 2) {
      nodes.push(h("text", { class: "tick", x: plotW / 2, y: top + plotH / 2, "text-anchor": "middle" }, "Collecting samples…"));
    } else {
      for (const ser of this.series) {
        const pts = visible.map((s) => `${x(s.t).toFixed(1)},${y(s[ser.key] || 0).toFixed(1)}`);
        const line = `M${pts.join("L")}`;
        const area = `${line}L${x(latest.t).toFixed(1)},${bottom}L${x(visible[0].t).toFixed(1)},${bottom}Z`;
        // Gradient in plot space: intensity tracks magnitude and never washes out at the top.
        const gradientId = `area-${this.uid}-${ser.key}`;
        nodes.push(h("defs", {}, h("linearGradient", { id: gradientId, gradientUnits: "userSpaceOnUse", x1: 0, y1: top, x2: 0, y2: bottom },
          h("stop", { class: "area-top", offset: "0", style: `stop-color:${ser.color}` }),
          h("stop", { class: "area-bottom", offset: "1", style: `stop-color:${ser.color}` }))));
        nodes.push(h("path", { d: area, fill: `url(#${gradientId})` }));
        nodes.push(h("path", { class: "line", d: line, style: `stroke:${ser.color}` }));
        nodes.push(h("circle", { class: "dot", cx: x(latest.t), cy: y(latest[ser.key] || 0), r: 3, style: `fill:${ser.color}` }));
      }
    }
    this.svg.replaceChildren(...nodes);

    // Text that carries the values (HIG: don't rely on color alone).
    const first = this.series[0];
    const peak = Math.max(0, ...visible.map((s) => s[first.key] || 0));
    const summary = latest
      ? (this.series.length === 1 ? `${this.format(latest[first.key] || 0)} now · peak ${this.format(peak)}` : "last 3 minutes")
      : "";
    this.summaryEl.textContent = summary;
    this.legendEl.replaceChildren(...(this.series.length > 1
      ? this.series.map((ser) => h("span", { style: { color: ser.color } }, h("i"), h("span", { style: { color: "var(--label-secondary)" } }, `${ser.label} ${latest ? this.format(latest[ser.key] || 0) : "—"}`)))
      : []));
    const spoken = this.series.map((ser) => `${ser.label} ${latest ? this.format(latest[ser.key] || 0) : "no data"}`).join(", ");
    this.svg.setAttribute("aria-label", `${this.title}, last 3 minutes. ${spoken}.`);
  }

  destroy() { this.resize.disconnect(); }
};

/* Tiny inline trend for table rows; decorative — the row prints the value as text. */
CS.sparkline = function sparkline(values, color, max) {
  const w = 56, h = 16;
  const svg = CS.h("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true", style: "vertical-align:middle" });
  if (values.length < 2) return svg;
  const top = max ?? CS.niceMax(Math.max(...values) * 1.1);
  const step = w / (values.length - 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - 1 - (Math.min(v, top) / top) * (h - 2)).toFixed(1)}`).join("");
  svg.append(CS.h("path", { d, fill: "none", stroke: color, "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  return svg;
};
