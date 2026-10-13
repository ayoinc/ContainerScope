"use strict";
CS.views = CS.views || {};

CS.mountLabel = (m) => m.type?.volume?.name || (m.type?.tmpfs ? "tmpfs" : m.source || "?");

CS.views.images = function images(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  let query = "";
  let pulling = false;

  const refInput = h("input", {
    type: "text", class: "field-wide mono", placeholder: "docker.io/library/alpine:latest",
    "aria-label": "Image reference to pull", onkeydown: (e) => { if (e.key === "Enter") pull(); },
  });
  const pullButton = ui.button("Pull", { icon: "download", kind: "prominent", onClick: () => pull() });
  const pullStatus = h("div");
  const search = h("input", { type: "search", class: "search-icon", placeholder: "Filter images", "aria-label": "Filter images", style: { width: "220px" }, oninput: (e) => { query = e.target.value.trim().toLowerCase(); render(); } });
  const summary = h("span", { class: "summary" });
  const listSlot = h("div");

  root.replaceChildren(h("div", { class: "stack" },
    h("section", {},
      ui.sectionHeader("Pull Image"),
      h("div", { class: "group" }, h("div", { class: "row" }, refInput, pullButton), pullStatus)),
    h("section", {},
      h("div", { class: "section-header" }, h("h2", {}, "Local Images"), summary, h("div", { class: "spacer" }), search,
        ui.button("Prune", { icon: "sweep", title: "Remove dangling images", onClick: async (e) => { if ((await CS.act(e.currentTarget, "imagePrune", {}, "Pruned dangling images")).ok) { store.load("images"); store.load("df"); } } })),
      listSlot)));

  async function pull() {
    const ref = refInput.value.trim();
    if (!ref || pulling) return;
    pulling = true;
    pullButton.disabled = true;
    pullStatus.replaceChildren(h("div", { class: "row", style: { marginTop: "var(--space-3)", color: "var(--label-secondary)" } }, h("div", { class: "spinner" }), `Pulling ${ref}…`));
    const result = await CS.act(null, "imagePull", { ref });
    pulling = false;
    pullButton.disabled = false;
    if (result.ok) {
      pullStatus.replaceChildren();
      refInput.value = "";
      CS.toast("Image pulled", ref);
      store.load("images"); store.load("df");
    } else {
      pullStatus.replaceChildren(h("pre", { class: "console", style: { marginTop: "var(--space-3)", color: "var(--red)" } }, result.error));
    }
  }

  function usage(image) {
    const digest = image.configuration.descriptor.digest;
    return (store.data.containers || []).filter((c) => c.configuration.image.descriptor.digest === digest);
  }

  function render() {
    if (store.errors.images && !store.data.images) { listSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.images))); return; }
    if (!store.data.images) { listSlot.replaceChildren(ui.loading()); return; }
    const all = store.data.images;
    const total = all.reduce((sum, i) => sum + i.variants.reduce((s, v) => s + (v.size || 0), 0), 0);
    summary.textContent = `${fmt.count(all.length, "image")} · ${fmt.bytes(total)}`;
    const rows = all.filter((i) => !query || i.configuration.name.toLowerCase().includes(query))
      .sort((a, b) => a.configuration.name.localeCompare(b.configuration.name));
    if (!rows.length) {
      listSlot.replaceChildren(h("div", { class: "group" }, ui.empty("stack", all.length ? "No matches" : "No images", all.length ? "No images match the filter." : "Pull an image to get started.")));
      return;
    }
    ui.showTable(listSlot, ui.table([
      { title: "Repository", width: "34%", render: (i) => { const r = CS.splitRef(i.configuration.name); return [h("span", { class: "primary-cell truncate", style: { display: "block" } }, r.repo), h("span", { class: "sub" }, r.tag)]; }, tooltip: (i) => i.configuration.name },
      { title: "Digest", width: "14%", render: (i) => h("span", { class: "mono secondary" }, fmt.digest(i.configuration.descriptor.digest)), tooltip: (i) => i.configuration.descriptor.digest },
      { title: "Platform", width: "14%", render: (i) => i.variants.map((v) => `${v.platform.os}/${v.platform.architecture}`).join(", ") },
      { title: "Size", align: "right", width: "10%", render: (i) => fmt.bytes(i.variants.reduce((s, v) => s + (v.size || 0), 0)) },
      { title: "Created", width: "14%", render: (i) => h("span", { class: "secondary" }, fmt.relative(i.configuration.creationDate)), tooltip: (i) => fmt.date(i.configuration.creationDate) },
      { title: "In Use", width: "8%", render: (i) => { const n = usage(i).length; return n ? h("span", { class: "badge accent" }, String(n)) : h("span", { class: "tertiary" }, "—"); }, tooltip: (i) => usage(i).map((c) => c.id).join(", ") },
      {
        title: "", width: "6%", className: "actions",
        render: (i) => h("div", { class: "row" }, ui.iconButton("trash", `Delete ${i.configuration.name}`, async (e) => {
          if ((await CS.act(e.currentTarget, "imageDelete", { ref: i.configuration.name }, "Image deleted")).ok) { store.load("images"); store.load("df"); }
        })),
      },
    ], rows, { className: "tall", rowKey: (i) => i.configuration.name }));
  }

  render();
  return { update(topic) { if (topic === "images" || topic === "containers") render(); }, destroy() {} };
};

CS.views.volumes = function volumes(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  const summary = h("span", { class: "summary" });
  const listSlot = h("div");
  root.replaceChildren(h("div", {}, h("div", { class: "section-header" }, h("h2", {}, "Volumes"), summary), listSlot));

  const users = (v) => (store.data.containers || []).filter((c) => (c.configuration.mounts || []).some((m) => m.type?.volume?.name === v.configuration.name));

  function render() {
    if (store.errors.volumes && !store.data.volumes) { listSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.volumes))); return; }
    if (!store.data.volumes) { listSlot.replaceChildren(ui.loading()); return; }
    const all = store.data.volumes;
    const used = store.data.df?.volumes?.sizeInBytes;
    summary.textContent = `${fmt.count(all.length, "volume")}${used !== undefined ? ` · ${fmt.bytes(used)} on disk` : ""}`;
    if (!all.length) { listSlot.replaceChildren(h("div", { class: "group" }, ui.empty("disk", "No volumes", "Create one with “container volume create <name>”."))); return; }
    ui.showTable(listSlot, ui.table([
      { title: "Name", width: "34%", render: (v) => h("span", { class: "primary-cell" }, v.configuration.name) },
      { title: "Driver", width: "12%", render: (v) => `${v.configuration.driver} · ${v.configuration.format}` },
      { title: "Capacity", align: "right", width: "12%", render: (v) => fmt.bytes(v.configuration.sizeInBytes, 0), tooltip: () => "Maximum size of the sparse disk image" },
      { title: "Created", width: "14%", render: (v) => h("span", { class: "secondary" }, fmt.relative(v.configuration.creationDate)), tooltip: (v) => fmt.date(v.configuration.creationDate) },
      { title: "Used By", width: "28%", render: (v) => { const u = users(v); return u.length ? h("span", { class: "chips row" }, u.map((c) => h("span", { class: "badge" }, c.id))) : h("span", { class: "tertiary" }, "Unused"); } },
    ], all, { rowKey: (v) => v.id }));
  }

  render();
  return { update(topic) { if (["volumes", "containers", "df"].includes(topic)) render(); }, destroy() {} };
};

CS.views.networks = function networks(root) {
  const { h, fmt, ui } = CS;
  const store = CS.store;
  const summary = h("span", { class: "summary" });
  const listSlot = h("div");
  root.replaceChildren(h("div", {}, h("div", { class: "section-header" }, h("h2", {}, "Networks"), summary), listSlot));

  const attached = (n) => (store.data.containers || []).filter((c) => (c.status?.networks || []).some((x) => x.network === n.id));

  function render() {
    if (store.errors.networks && !store.data.networks) { listSlot.replaceChildren(h("div", { class: "group" }, ui.unavailable(store.errors.networks))); return; }
    if (!store.data.networks) { listSlot.replaceChildren(ui.loading()); return; }
    const all = store.data.networks;
    summary.textContent = fmt.count(all.length, "network");
    ui.showTable(listSlot, ui.table([
      { title: "Name", width: "18%", render: (n) => [h("span", { class: "primary-cell" }, n.configuration.name), " ", n.configuration.labels?.["com.apple.container.resource.role"] === "builtin" ? h("span", { class: "badge" }, "Built-in") : null] },
      { title: "Mode", width: "8%", render: (n) => n.configuration.mode.toUpperCase() },
      { title: "IPv4 Subnet", width: "16%", render: (n) => h("span", { class: "mono" }, n.status?.ipv4Subnet || "—") },
      { title: "Gateway", width: "14%", render: (n) => h("span", { class: "mono" }, n.status?.ipv4Gateway || "—") },
      { title: "IPv6 Subnet", width: "22%", render: (n) => h("span", { class: "mono secondary" }, n.status?.ipv6Subnet || "—") },
      { title: "Containers", width: "22%", render: (n) => { const a = attached(n); return a.length ? h("span", { class: "chips row" }, a.map((c) => h("span", { class: "badge", title: c.status.networks.find((x) => x.network === n.id)?.ipv4Address }, c.id))) : h("span", { class: "tertiary" }, "None"); } },
    ], all, { rowKey: (n) => n.id }));
  }

  render();
  return { update(topic) { if (topic === "networks" || topic === "containers") render(); }, destroy() {} };
};
