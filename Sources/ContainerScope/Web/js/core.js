"use strict";
/* Core helpers shared by every view: native bridge, DOM builder, formatting, icons, toasts. */
window.CS = {};

/* ---------- Native bridge ---------- */
CS.call = async function call(method, params = {}) {
  const handler = window.webkit?.messageHandlers?.bridge;
  if (!handler) throw new Error("Native bridge unavailable");
  return handler.postMessage({ method, params });
};
CS.json = async function json(method, params) {
  const text = await CS.call(method, params);
  return text.trim() ? JSON.parse(text) : null;
};

/* ---------- DOM ---------- */
CS.h = function h(tag, props, ...children) {
  const el = tag === "svg" || CS.h.svgTags.has(tag)
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && !(el instanceof SVGElement)) el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
};
CS.h.svgTags = new Set(["path", "line", "circle", "rect", "g", "text", "polyline", "defs", "linearGradient", "stop"]);

/* ---------- Formatting ---------- */
CS.fmt = {
  bytes(n, digits = 1) {
    if (!Number.isFinite(n)) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (Math.abs(n) >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    const value = i === 0 ? String(Math.round(n)) : n.toFixed(n >= 100 ? 0 : digits).replace(/\.0+$/, "");
    return `${value} ${units[i]}`;
  },
  rate(n) { return Number.isFinite(n) ? `${CS.fmt.bytes(n)}/s` : "—"; },
  percent(n, digits = 0) {
    if (!Number.isFinite(n)) return "—";
    return `${n < 10 && digits === 0 && n > 0 ? n.toFixed(1) : n.toFixed(digits)}%`;
  },
  count(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; },
  relative(date) {
    if (!date) return "—";
    const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const steps = [[60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]];
    let value = seconds / 60;
    for (const [size, unit] of steps) {
      if (value < size) return `${Math.floor(value)} ${unit}${Math.floor(value) === 1 ? "" : "s"} ago`;
      value /= size;
    }
  },
  duration(date) {
    if (!date) return "—";
    let s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  },
  date(date) {
    return date ? new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
  },
  digest(d) { return d ? d.replace(/^sha256:/, "").slice(0, 12) : "—"; },
};

/* Image reference → { repo, tag } for two-line display. */
CS.splitRef = function splitRef(ref = "") {
  const at = ref.indexOf("@");
  if (at > 0) return { repo: ref.slice(0, at), tag: ref.slice(at + 1, at + 20) };
  const colon = ref.lastIndexOf(":");
  const slash = ref.lastIndexOf("/");
  if (colon > slash) return { repo: ref.slice(0, colon), tag: ref.slice(colon + 1) };
  return { repo: ref, tag: "latest" };
};

/* ---------- Icons (stroke icons drawn to SF Symbols proportions) ---------- */
CS.icon = function icon(name) {
  const paths = {
    play: "M5 3.5v9l7.5-4.5z",
    stop: "M4.5 4.5h7v7h-7z",
    bolt: "M9 1.5 3.5 9h4l-1 5.5L12.5 7h-4z",
    trash: "M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v5M9.25 6.5v5",
    terminal: "M2 3h12v10H2zM4.5 6.5l2 1.75-2 1.75M8 10.5h3.5",
    chevronLeft: "M10 3 5 8l5 5",
    refresh: "M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3",
    download: "M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11",
    copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
    box: "M8 1.5 14 4.75v6.5L8 14.5 2 11.25v-6.5zM2 4.75 8 8l6-3.25M8 8v6.5",
    stack: "M8 2 14 5 8 8 2 5zM2 8l6 3 6-3M2 11l6 3 6-3",
    disk: "M2 9.5 4 3h8l2 6.5v3.5H2zM2 9.5h12M11 11.25h.01",
    network: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c2 2 2.6 4.2 2.6 6.5S10 12.5 8 14.5M8 1.5C6 3.5 5.4 5.7 5.4 8S6 12.5 8 14.5",
    power: "M8 1.5v6M4.4 3.6a5.5 5.5 0 1 0 7.2 0",
    warning: "M8 2 14.5 13.5h-13zM8 6.5v3.5M8 12h.01",
    sweep: "M10 2 6.5 8.5M3 9.5h7l1.5 5h-10z",
    display: "M1.5 2.5h13v8.5h-13zM5.5 14h5M8 11v3",
    keyboard: "M1.5 4h13v8h-13zM4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6",
  };
  const fill = name === "play" || name === "stop";
  return CS.h("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", fill: fill ? "currentColor" : "none", stroke: fill ? "none" : "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" },
    CS.h("path", { d: paths[name] || "" }));
};

/* ---------- Toasts ---------- */
CS.toast = function toast(title, body, kind = "info") {
  const host = document.getElementById("toasts");
  const el = CS.h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" },
    CS.h("div", {}, CS.h("div", { class: "title" }, title), body ? CS.h("div", { class: "body" }, body) : null));
  host.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 8000 : 4000);
};

/* Runs a native action with busy state on the button and toasts on outcome. */
CS.act = async function act(button, method, params, successTitle) {
  button?.classList.add("busy");
  try {
    const out = await CS.call(method, params);
    if (successTitle) CS.toast(successTitle);
    return { ok: true, out };
  } catch (error) {
    const message = String(error?.message || error);
    if (message !== "Cancelled") CS.toast("Action failed", message, "error");
    return { ok: false, error: message };
  } finally {
    button?.classList.remove("busy");
  }
};

/* ---------- Shared building blocks ---------- */
CS.ui = {
  sectionHeader(title, summary, ...actions) {
    return CS.h("div", { class: "section-header" },
      CS.h("h2", {}, title),
      summary ? CS.h("span", { class: "summary" }, summary) : null,
      CS.h("div", { class: "spacer" }),
      ...actions);
  },
  button(label, { icon, kind = "", onClick, title, disabled } = {}) {
    return CS.h("button", { class: kind, onclick: onClick, title, "aria-label": title || label, disabled },
      icon ? CS.icon(icon) : null, label);
  },
  iconButton(icon, title, onClick, kind = "plain") {
    return CS.h("button", { class: `icon ${kind}`, title, "aria-label": title, onclick: (e) => { e.stopPropagation(); onClick(e); } }, CS.icon(icon));
  },
  segmented(options, value, onChange, label) {
    const el = CS.h("div", { class: "segmented", role: "group", "aria-label": label });
    for (const [key, text] of options) {
      el.append(CS.h("button", {
        "aria-pressed": String(key === value),
        onclick: () => {
          for (const b of el.children) b.setAttribute("aria-pressed", "false");
          el.querySelector(`[data-key="${key}"]`).setAttribute("aria-pressed", "true");
          onChange(key);
        },
        "data-key": key,
      }, text));
    }
    return el;
  },
  status(state) {
    const s = state || "unknown";
    return CS.h("span", { class: `status ${s}` }, s[0].toUpperCase() + s.slice(1));
  },
  empty(icon, title, body, action) {
    return CS.h("div", { class: "empty" }, CS.icon(icon), CS.h("h3", {}, title), body ? CS.h("p", {}, body) : null, action || null);
  },
  loading(text = "Loading…") {
    return CS.h("div", { class: "loading" }, CS.h("div", { class: "spinner", role: "progressbar", "aria-label": text }), text);
  },
  meter(fraction, color) {
    const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
    return CS.h("div", { class: "meter", role: "meter", "aria-valuenow": Math.round(pct), "aria-valuemin": 0, "aria-valuemax": 100 },
      CS.h("span", { style: { width: `${pct}%`, "--meter-color": color } }));
  },
  /* Services stopped or CLI missing: one consistent recovery message. */
  unavailable(error) {
    return CS.ui.empty("power", "Container services aren't reachable",
      `${error}\n\nUse Start Services in the toolbar, or run “container system start” in Terminal.`);
  },
  /*
    Puts `next` (from ui.table) into `slot`, reusing the live table when the columns match.
    Rows are matched by data-key and only cells whose markup changed are swapped, so polling
    never steals focus, resets hover, or drops a click that lands mid-refresh.
  */
  showTable(slot, next) {
    const current = slot.querySelector(":scope > .group.flush > table.table");
    const signature = (t) => `${t.className}|${[...t.tHead.rows[0].cells].map((c) => c.textContent).join("|")}`;
    if (!current || signature(current) !== signature(next)) {
      slot.replaceChildren(CS.h("div", { class: "group flush" }, next));
      return;
    }
    const body = current.tBodies[0];
    const keyOf = (tr, i) => tr.dataset.key ?? `#${i}`;
    const existing = new Map([...body.rows].map((tr, i) => [keyOf(tr, i), tr]));
    const ordered = [...next.tBodies[0].rows].map((tr, i) => {
      const key = keyOf(tr, i);
      const old = existing.get(key);
      if (!old) return tr;
      existing.delete(key);
      [...tr.cells].forEach((cell, j) => {
        const prev = old.cells[j];
        if (prev.innerHTML !== cell.innerHTML) prev.replaceChildren(...cell.childNodes);
        if (prev.title !== cell.title) prev.title = cell.title;
      });
      return old;
    });
    for (const tr of existing.values()) tr.remove();
    ordered.forEach((tr, i) => { if (body.rows[i] !== tr) body.insertBefore(tr, body.rows[i] || null); });
  },
  table(columns, rows, { onRowClick, rowKey, className = "" } = {}) {
    const colgroup = CS.h("colgroup", {}, columns.map((c) => CS.h("col", { style: c.width ? { width: c.width } : {} })));
    const head = CS.h("thead", {}, CS.h("tr", {}, columns.map((c) => CS.h("th", { class: c.align || "", scope: "col" }, c.title))));
    const body = CS.h("tbody");
    for (const row of rows) {
      const tr = CS.h("tr", {
        class: onRowClick ? "clickable" : "",
        tabindex: onRowClick ? "0" : null,
        "data-key": rowKey ? rowKey(row) : null,
        onclick: onRowClick ? () => onRowClick(row) : null,
        onkeydown: onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : null,
      });
      for (const c of columns) {
        const td = CS.h("td", { class: [c.align, c.className].filter(Boolean).join(" ") });
        const content = c.render(row);
        td.append(...[content].flat().filter((x) => x !== null && x !== undefined).map((x) => (x instanceof Node ? x : document.createTextNode(String(x)))));
        if (c.tooltip) td.title = c.tooltip(row);
        tr.append(td);
      }
      body.append(tr);
    }
    return CS.h("table", { class: `table ${className}` }, colgroup, head, body);
  },
};

/* What ContainerScope needs, from hostInfo: what ships inside the app, what the user provides.
   state: "included" (bundled), "ok" (present on this Mac), "action" (user step), "optional", "missing" (blocks use). */
CS.requirements = function requirements(host) {
  const b = host.bundled || {};
  const engine = host.engine || {};
  const major = parseInt(String(host.macOS || "0").split(".")[0], 10);
  const fromImage = engine.source === "bundled" && /\/AppTranslocation\/|^\/Volumes\//.test(host.appPath || "");
  const engineSource = { homebrew: "Homebrew", installer: "Apple's installer", custom: "CONTAINER_BIN", path: "your PATH" }[engine.source];
  return [
    { name: "Mac with Apple silicon, macOS 26 or later", state: host.hypervisor && major >= 26 ? "ok" : "missing",
      detail: `${host.chip || "Unknown chip"} · macOS ${host.macOS || "?"}` },
    fromImage
      ? { name: "Container engine", state: "missing", detail: "Move ContainerScope to Applications and open it from there. The bundled engine runs from inside the app, so it can't run from the disk image." }
      : engine.source === "bundled"
        ? { name: "Container engine", state: "included", detail: `Apple container ${b.container || ""}, bundled. Updates arrive with ContainerScope.` }
        : engine.source === "missing"
          ? { name: "Container engine", state: "missing", detail: "Not found in the app. Download ContainerScope again." }
          : { name: "Container engine", state: "ok", detail: `Using the engine from ${engineSource} (${engine.path}). The bundled engine ${b.container || ""} stays unused while it's installed.` },
    engine.source === "bundled"
      ? { name: "Linux kernel for containers", state: "included", detail: `${b.kernel || ""}, installed on first start` }
      : { name: "Linux kernel for containers", state: "ok", detail: "Managed by your installed engine (see Guest Kernel below)" },
    { name: "QEMU and swtpm (Windows on ARM)", state: b.qemu ? "included" : "missing", detail: b.qemu ? `QEMU ${b.qemu} · swtpm ${b.swtpm}` : "Missing from this copy of the app" },
    { name: "Secure Boot UEFI firmware", state: b.firmware ? "included" : "missing", detail: b.firmware || "Missing from this copy of the app" },
    host.rosetta === "installed"
      ? { name: "Rosetta 2", state: "ok", detail: "Installed" }
      : { name: "Rosetta 2", state: host.rosetta === "notSupported" ? "missing" : "action", install: host.rosetta === "notInstalled",
          detail: "Part of macOS, installed separately. Needed for Kubernetes and x86-64 images." },
    { name: "Windows 11 ARM64 install media", state: "action", route: "windows", detail: "Licensed by Microsoft, so not included. Download it in Windows on ARM." },
    { name: "VirtIO drivers for Windows", state: "action", route: "windows", detail: "Network and display drivers (about 880 MB). Download them in Windows on ARM." },
    { name: "Container images", state: "action", detail: "Pulled from registries such as Docker Hub when you use them. Needs internet access." },
    { name: "Docker API for Docker CLI, Compose and Vagrant", state: host.dockerSocket ? "ok" : "optional",
      detail: host.dockerSocket ? `socktainer at ${host.dockerSocket}` : "Optional: brew install socktainer" },
  ];
};

CS.requirementLabel = { included: "Included", ok: "Ready", action: "You provide", optional: "Optional", missing: "Needs attention" };
