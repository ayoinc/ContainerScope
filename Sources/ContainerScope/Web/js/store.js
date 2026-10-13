"use strict";
/*
  Single source of truth for CLI data. Polls the native bridge, derives rates from
  cumulative counters, keeps a 3-minute history per container plus an aggregate,
  and notifies views by topic.
*/
CS.store = {
  data: { containers: null, stats: null, df: null, images: null, volumes: null, networks: null, status: null },
  errors: {},
  history: new Map(),   // container id → samples
  aggregate: [],        // whole-system samples
  previous: new Map(),  // container id → { t, raw } for rate derivation
  listeners: new Set(),
  timers: [],

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(topic) { for (const fn of this.listeners) fn(topic); },

  async load(topic) {
    const method = { containers: "containers", df: "df", images: "images", volumes: "volumes", networks: "networks", status: "status", machines: "machines", properties: "properties" }[topic];
    try {
      this.data[topic] = await CS.json(method);
      delete this.errors[topic];
    } catch (error) {
      this.errors[topic] = String(error?.message || error);
    }
    this.emit(topic);
  },

  /* `container k8s list` has no JSON output: slice rows at the header's column offsets. */
  async loadK8s() {
    try {
      const text = await CS.call("k8sList");
      const lines = text.split("\n").filter((l) => l.trim());
      const header = lines[0] || "";
      const cols = [...header.matchAll(/\S+/g)].map((m) => ({ name: m[0].toLowerCase(), start: m.index }));
      const rows = lines.slice(1).map((line) => Object.fromEntries(cols.map((c, i) =>
        [c.name, line.slice(c.start, cols[i + 1]?.start ?? line.length).trim()])));
      // A cluster name is printed once; following node rows inherit it.
      let cluster = "";
      for (const r of rows) { cluster = r.cluster || cluster || r.node; r.cluster = cluster; }
      this.data.k8s = rows;
      delete this.errors.k8s;
    } catch (error) {
      this.errors.k8s = String(error?.message || error);
    }
    this.emit("k8s");
  },

  health: {},          // network id → diagnosis result
  diagnosing: new Set(),
  lastRoute: null,

  async diagnose(network) {
    if (this.diagnosing.has(network)) return;
    this.diagnosing.add(network);
    this.emit("health");
    try {
      this.health[network] = await CS.json("networkDiagnose", { id: network });
    } catch (error) {
      this.health[network] = { network, verdict: "error", summary: "Diagnosis failed", detail: String(error?.message || error) };
    } finally {
      this.diagnosing.delete(network);
      this.emit("health");
    }
  },

  natNetworks() { return (this.data.networks || []).filter((n) => n.configuration.mode === "nat").map((n) => n.id); },

  /* VPNs toggling (route interface changes) is the usual cause of egress flipping; re-test then. */
  async watchRoute() {
    const route = (await CS.call("routeInterface").catch(() => "")).trim();
    if (this.lastRoute !== null && route !== this.lastRoute) {
      for (const id of Object.keys(this.health)) this.diagnose(id);
    }
    this.lastRoute = route;
  },

  containerById(id) { return (this.data.containers || []).find((c) => c.id === id); },
  cpusFor(id) { return this.containerById(id)?.configuration?.resources?.cpus || 1; },

  async loadStats() {
    const running = (this.data.containers || []).filter((c) => c.status?.state === "running");
    let raw = [];
    if (running.length) {
      try {
        raw = (await CS.json("stats")) || [];
        delete this.errors.stats;
      } catch (error) {
        this.errors.stats = String(error?.message || error);
      }
    }
    const t = Date.now();
    let cpuUsec = 0, cpuCapacity = 0, mem = 0, memLimit = 0, rx = 0, tx = 0, haveRates = false;

    for (const s of raw) {
      const prev = this.previous.get(s.id);
      const cpus = this.cpusFor(s.id);
      const sample = { t, mem: s.memoryUsageBytes, memLimit: s.memoryLimitBytes, procs: s.numProcesses, cpu: 0, rx: 0, tx: 0, read: 0, write: 0 };
      if (prev && t > prev.t) {
        const dt = (t - prev.t) / 1000;
        const dUsec = Math.max(0, s.cpuUsageUsec - prev.raw.cpuUsageUsec);
        sample.cpu = Math.min(100, (dUsec / (dt * 1e6 * cpus)) * 100);
        sample.cores = dUsec / (dt * 1e6);
        sample.rx = Math.max(0, s.networkRxBytes - prev.raw.networkRxBytes) / dt;
        sample.tx = Math.max(0, s.networkTxBytes - prev.raw.networkTxBytes) / dt;
        sample.read = Math.max(0, s.blockReadBytes - prev.raw.blockReadBytes) / dt;
        sample.write = Math.max(0, s.blockWriteBytes - prev.raw.blockWriteBytes) / dt;
        cpuUsec += dUsec / dt;
        rx += sample.rx; tx += sample.tx;
        haveRates = true;
        const list = this.history.get(s.id) || [];
        list.push(sample);
        while (list.length && list[0].t < t - CS.WINDOW_MS) list.shift();
        this.history.set(s.id, list);
      }
      cpuCapacity += cpus;
      mem += s.memoryUsageBytes;
      memLimit += s.memoryLimitBytes;
      this.previous.set(s.id, { t, raw: s });
    }

    const live = new Set(raw.map((s) => s.id));
    for (const id of [...this.previous.keys()]) if (!live.has(id)) { this.previous.delete(id); this.history.delete(id); }

    this.data.stats = raw;
    if (haveRates || !raw.length) {
      this.aggregate.push({ t, cpu: cpuCapacity ? Math.min(100, (cpuUsec / (1e6 * cpuCapacity)) * 100) : 0, cores: cpuUsec / 1e6, cpuCapacity, mem, memLimit, rx, tx });
      while (this.aggregate.length && this.aggregate[0].t < t - CS.WINDOW_MS) this.aggregate.shift();
    }
    this.emit("stats");
  },

  latest(id) {
    const list = this.history.get(id);
    return list && list[list.length - 1];
  },

  refreshAll() {
    return Promise.all([
      this.load("containers").then(() => this.loadStats()),
      this.load("df"), this.load("images"), this.load("volumes"), this.load("networks"), this.load("status"),
      this.load("machines"), this.load("properties"), this.loadK8s(),
    ]);
  },

  start() {
    const every = (ms, fn, { whileHidden = false } = {}) =>
      this.timers.push(setInterval(() => { if (whileHidden || !document.hidden) fn(); }, ms));
    this.refreshAll().then(() => { for (const id of this.natNetworks()) this.diagnose(id); });
    // Stats keep sampling while the window is covered so the 3-minute history has no gaps.
    every(2000, () => this.loadStats(), { whileHidden: true });
    every(5000, () => this.load("containers"), { whileHidden: true });
    every(10000, () => { this.load("machines"); this.loadK8s(); });
    every(15000, () => { this.load("df"); this.load("images"); this.load("volumes"); this.load("networks"); this.load("status"); this.watchRoute(); });
  },
};
