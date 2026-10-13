"use strict";
CS.views = CS.views || {};

/*
  Windows: Windows 11 on ARM guests on QEMU + Hypervisor.framework.
  Installer ISOs download into a temporary folder and are cleaned up from here once setup is done.
*/
CS.views.windows = function windows(root) {
  const { h, fmt, ui } = CS;
  const MS_PAGE = "https://www.microsoft.com/software-download/windows11arm64";
  let state = null;
  let error = null;
  let timer = null;
  const attach = {};          // iso path → attach at next boot (default on)
  const extraISOs = [];       // ISOs picked from elsewhere on disk (never cleaned up)

  const field = (label, control, wide) => h("label", { class: `field${wide ? " wide" : ""}` }, h("span", {}, label), control);
  const urlInput = h("input", { type: "url", class: "mono", placeholder: "https://software.download.prss.microsoft.com/…_arm64_….iso", "aria-label": "Windows ISO download link" });
  const editionSelect = h("select", { "aria-label": "Windows version", disabled: true }, h("option", {}, "Loading from Microsoft…"));
  const languageSelect = h("select", { "aria-label": "Windows language", disabled: true }, h("option", {}, "—"));
  const windowsButton = ui.button("Download Windows", { icon: "download", kind: "prominent", disabled: true, onClick: (e) => downloadWindows(e.currentTarget) });
  const catalogStatus = h("span", { class: "secondary" }, "Official Microsoft source · signed link fetched at download time");
  const name = h("input", { type: "text", value: "win11", "aria-label": "VM name" });
  const cpus = h("input", { type: "number", min: 2, max: 64, value: 4, "aria-label": "CPUs" });
  const memory = h("input", { type: "number", min: 4, max: 256, value: 8, "aria-label": "Memory (GB)" });
  const disk = h("input", { type: "number", min: 64, max: 2048, value: 64, "aria-label": "Disk (GB)" });
  const createButton = ui.button("Create VM", { icon: "play", kind: "prominent", onClick: () => create() });

  const toolsSlot = h("div");
  const mediaSlot = h("div");
  const mediaSummary = h("span", { class: "summary" });
  const vmSlot = h("div");
  const vmSummary = h("span", { class: "summary" });
  const logSlot = h("div");

  root.replaceChildren(h("div", { class: "stack" },
    toolsSlot,
    h("section", {},
      h("div", { class: "section-header" }, h("h2", {}, "Installer Media"), mediaSummary, h("div", { class: "spacer" }),
        ui.button("Clean Up", { icon: "sweep", title: "Delete downloaded ISOs from the temporary folder", onClick: (e) => cleanup(e.currentTarget) })),
      h("div", { class: "group stack-tight" },
        h("div", { class: "row wrap" }, field("Windows on ARM", editionSelect, true), field("Language", languageSelect), windowsButton),
        catalogStatus,
        h("details", {},
          h("summary", { class: "secondary" }, "Use a link instead"),
          h("div", { class: "row wrap" }, field("Windows ISO link", urlInput, true),
            ui.button("Download", { icon: "download", onClick: (e) => download(e.currentTarget, "isoDownload", { url: urlInput.value }) }),
            ui.button("Open Microsoft Download Page", { kind: "plain", onClick: () => CS.call("openURL", { url: MS_PAGE }) }))),
        h("div", { class: "row wrap" },
          h("span", { class: "secondary" }, "VirtIO drivers give Windows its network adapter."),
          h("span", { class: "spacer" }),
          ui.button("Download VirtIO Drivers", { icon: "download", onClick: (e) => download(e.currentTarget, "isoDownloadVirtio", {}) }),
          ui.button("Use ISO on Disk…", { kind: "plain", onClick: (e) => chooseISO(e.currentTarget) }))),
      mediaSlot),
    h("section", {},
      ui.sectionHeader("New Windows VM", "Windows 11 on ARM · Hypervisor.framework · UEFI · TPM 2.0 · NVMe"),
      h("div", { class: "group stack-tight" },
        h("div", { class: "form-grid" }, field("Name", name), field("CPUs", cpus), field("Memory (GB)", memory), field("Disk (GB)", disk)),
        h("div", { class: "row" }, h("span", { class: "secondary" }, "The disk grows on demand; 64 GB is Windows 11's minimum."), h("span", { class: "spacer" }), createButton))),
    h("section", {}, h("div", { class: "section-header" }, h("h2", {}, "Virtual Machines"), vmSummary), vmSlot),
    logSlot,
    h("section", {},
      ui.sectionHeader("Setup Notes"),
      h("div", { class: "group stack-tight" },
        h("p", {}, "Press any key in the VM window when it says ", h("code", {}, "Press any key to boot from CD or DVD"), "."),
        h("p", {}, "No network during setup? Press ", h("code", {}, "Shift+F10"), ", run ", h("code", {}, "OOBE\\BYPASSNRO"), ", and choose “I don't have internet”."),
        h("p", {}, "After first login, install the ARM64 VirtIO drivers (network, display, balloon…). ", h("code", {}, "virtio-win-guest-tools.exe"), " is x64-only. In an administrator terminal, with the VirtIO CD as ", h("code", {}, "E:"), ", run ", h("code", {}, "pnputil /add-driver E:\\*\\w11\\ARM64\\*.inf /subdirs /install"), "."),
        h("p", {}, "Then shut down and switch the VM's display to VirtIO GPU so the window can be resized and Windows follows its size. Basic display (ramfb) has a fixed size; the window then only scales the picture."),
        h("p", {}, "Once Windows is installed, start the VM with no media attached and use Clean Up to delete the ISOs.")))));

  async function refresh() {
    try { state = await CS.json("winStatus"); error = null; } catch (e) { error = String(e?.message || e); }
    render();
    clearTimeout(timer);
    const busy = state?.media.some((m) => m.state === "downloading");
    timer = setTimeout(refresh, busy ? 1000 : 4000);
  }

  async function download(button, method, params) {
    const result = await CS.act(button, method, params, "Download started");
    if (result.ok) { if (method === "isoDownload") urlInput.value = ""; refresh(); }
  }

  /* Versions and languages come straight from Microsoft's Arm64 download page. */
  async function loadCatalog() {
    try {
      const catalog = await CS.json("winCatalog");
      editionSelect.replaceChildren(...catalog.editions.map((e) => h("option", { value: e.id }, e.name)));
      editionSelect.value = catalog.edition;
      const preferred = navigator.language.startsWith("en-GB") ? "English International" : "English (United States)";
      languageSelect.replaceChildren(...catalog.languages.map((l) => h("option", { value: l }, l)));
      languageSelect.value = catalog.languages.includes(preferred) ? preferred : catalog.languages[0];
      editionSelect.disabled = languageSelect.disabled = windowsButton.disabled = false;
      catalogStatus.textContent = `Official Microsoft source · ${catalog.languages.length} languages · signed link fetched at download time`;
    } catch (e) {
      editionSelect.replaceChildren(h("option", {}, "Unavailable"));
      catalogStatus.replaceChildren(h("span", { style: { color: "var(--red)" } }, `Couldn't load versions: ${String(e?.message || e)} `),
        ui.button("Retry", { kind: "plain", onClick: () => { catalogStatus.textContent = "Loading…"; loadCatalog(); } }));
    }
  }

  async function downloadWindows(button) {
    catalogStatus.textContent = "Requesting a signed link from Microsoft…";
    const result = await CS.act(button, "isoDownloadWindows", { edition: editionSelect.value, language: languageSelect.value }, "Windows download started");
    catalogStatus.textContent = result.ok ? `Downloading ${result.out}` : "Official Microsoft source · signed link fetched at download time";
    if (result.ok) refresh();
  }

  async function chooseISO(button) {
    const pick = await CS.act(button, "isoChoose", {});
    if (pick.ok && !extraISOs.includes(pick.out)) { extraISOs.push(pick.out); render(); }
  }

  async function cleanup(button) {
    const result = await CS.act(button, "isoCleanup", {});
    if (result.ok) { CS.toast("Installer media cleaned up", `${fmt.bytes(Number(result.out))} freed`); refresh(); }
  }

  async function create() {
    const params = { id: name.value.trim(), cpus: Number(cpus.value), memoryGB: Number(memory.value), diskGB: Number(disk.value) };
    if (!params.id) { name.focus(); return; }
    if ((await CS.act(createButton, "winCreate", params, `${params.id} created`)).ok) refresh();
  }

  /* Windows setup first (it boots), driver discs after. */
  function bootMedia() {
    const ready = [...(state?.media || []).filter((m) => m.state === "done").map((m) => m.path), ...extraISOs];
    return ready.filter((p) => attach[p] !== false)
      .sort((a, b) => /virtio/i.test(a) - /virtio/i.test(b));
  }

  async function vmAction(button, method, id, done) {
    const params = { id };
    if (method === "winStart") params.isos = bootMedia();
    const result = await CS.act(button, method, params, done);
    if (result.ok) setTimeout(refresh, 600);
  }

  async function showLog(id) {
    try {
      const text = await CS.call("winLog", { id });
      logSlot.replaceChildren(h("section", {}, ui.sectionHeader(`QEMU log · ${id}`, "", ui.button("Close", { kind: "plain", onClick: () => logSlot.replaceChildren() })),
        h("pre", { class: "console" }, text.trim() || "(empty)")));
    } catch (e) { CS.toast("Log unavailable", String(e?.message || e), "error"); }
  }
  let fetchingFirmware = false;

  function renderTools() {
    const missing = [!state.qemu && "QEMU", !state.swtpm && "swtpm"].filter(Boolean);
    toolsSlot.replaceChildren(missing.length
      ? h("div", { class: "callout warning row wrap" }, `${missing.join(" and ")} not found. Windows VMs need QEMU (Hypervisor.framework) and swtpm (TPM 2.0).`,
        h("span", { class: "spacer" }),
        state.homebrew ? ui.button("Install QEMU", { kind: "prominent", onClick: async (e) => { if ((await CS.act(e.currentTarget, "winInstallTools", {}, "QEMU and swtpm installed")).ok) refresh(); } })
          : h("span", {}, "Install Homebrew, then run ", h("code", {}, "brew install qemu swtpm")))
      : h("div", { class: "stack-tight" },
        h("div", { class: "checks" },
          h("span", { class: "check pass" }, h("span", {}, "✓"), " QEMU with Hypervisor.framework"),
          h("span", { class: `check ${state.secureBoot ? "pass" : "fail"}` }, h("span", {}, state.secureBoot ? "✓" : "✕"), " UEFI Secure Boot (Microsoft keys)"),
          h("span", { class: "check pass" }, h("span", {}, "✓"), " swtpm TPM 2.0")),
        state.secureBoot ? null : h("div", { class: "callout warning row wrap" },
          "Windows 11 Setup requires Secure Boot. Homebrew's ARM64 UEFI build doesn't include it, so ContainerScope builds Ubuntu's Secure Boot firmware (qemu-efi-aarch64, Microsoft keys enrolled) with its boot logo, inside your container engine. Takes about 3 minutes.",
          h("span", { class: "spacer" }),
          fetchingFirmware ? h("span", { class: "row secondary" }, h("div", { class: "spinner" }), "Building firmware…")
            : ui.button("Get Secure Boot Firmware", { kind: "prominent", onClick: async (e) => {
              fetchingFirmware = true; renderTools();
              const result = await CS.act(e.currentTarget, "winSecureBootFirmware", {}, "Secure Boot firmware installed");
              fetchingFirmware = false;
              refresh();
              return result;
            } }))));
  }

  function renderMedia() {
    const items = [...state.media, ...extraISOs.map((p) => ({ name: p.split("/").pop(), path: p, state: "done", external: true }))];
    const stored = state.media.filter((m) => m.state === "done").reduce((sum, m) => sum + m.size, 0);
    mediaSummary.textContent = `${fmt.bytes(stored)} in ${state.mediaDir.replace(/^\/private/, "")}`;
    mediaSummary.title = state.mediaDir;
    if (!items.length) { mediaSlot.replaceChildren(); return; }
    ui.showTable(mediaSlot, ui.table([
      {
        title: "Attach", width: "8%",
        render: (m) => m.state !== "done" ? "" : h("input", {
          type: "checkbox", checked: attach[m.path] !== false, "aria-label": `Attach ${m.name} at next boot`,
          onchange: (e) => { attach[m.path] = e.currentTarget.checked; },
        }),
      },
      { title: "Image", width: "40%", render: (m) => [h("span", { class: "primary-cell mono" }, m.name), h("span", { class: "sub" }, m.external ? "On disk (not cleaned up)" : m.inUse ? "Attached to a running VM" : m.state === "failed" ? m.error : "Temporary download")] },
      {
        title: "Progress", width: "34%",
        render: (m) => m.state === "downloading"
          ? h("div", { class: "stack-tight" }, ui.meter(m.total ? m.received / m.total : 0), h("span", { class: "secondary" }, m.total ? `${fmt.bytes(m.received)} of ${fmt.bytes(m.total)}` : `${fmt.bytes(m.received)}…`))
          : m.state === "failed" ? h("span", { class: "verdict blocked" }, "Failed")
          : h("span", { class: "verdict ok" }, m.size ? fmt.bytes(m.size) : "Ready"),
      },
      {
        title: "", width: "18%", className: "actions",
        render: (m) => h("div", { class: "row" },
          m.state === "downloading"
            ? ui.iconButton("stop", `Cancel download of ${m.name}`, async (e) => { await CS.act(e.currentTarget, "isoCancel", { name: m.name }, "Download cancelled"); refresh(); })
            : m.external
              ? ui.iconButton("trash", `Forget ${m.name}`, () => { extraISOs.splice(extraISOs.indexOf(m.path), 1); render(); })
              : ui.iconButton("trash", `Delete ${m.name}`, async (e) => { if ((await CS.act(e.currentTarget, "isoDelete", { name: m.name }, `Deleted ${m.name}`)).ok) refresh(); })),
      },
    ], items, { rowKey: (m) => m.path }));
  }

  async function setDisplay(button, id, display, label) {
    if ((await CS.act(button, "winSetDisplay", { id, display }, `${id} will use ${label} on next start`)).ok) refresh();
  }

  function renderVMs() {
    const vms = state.vms;
    vmSummary.textContent = `${vms.filter((v) => v.running).length} running · ${vms.length} total`;
    if (!vms.length) { vmSlot.replaceChildren(h("div", { class: "group" }, ui.empty("box", "No Windows VMs", "Download the Windows ISO and VirtIO drivers, then create a VM above."))); return; }
    ui.showTable(vmSlot, ui.table([
      { title: "Name", width: "20%", render: (v) => [h("span", { class: "primary-cell" }, v.id), h("span", { class: "sub" }, ui.status(v.running ? "running" : "stopped"))] },
      { title: "Resources", width: "16%", render: (v) => `${v.cpus} CPU · ${v.memoryGB} GB` },
      { title: "Disk", width: "15%", render: (v) => `${fmt.bytes(v.diskUsed)} of ${v.diskGB} GB` },
      { title: "Display", width: "13%", render: (v) => v.display === "virtio-gpu" ? "VirtIO GPU" : "Basic (ramfb)" },
      { title: "Media", width: "14%", render: (v) => h("span", { class: "secondary truncate" }, v.running ? (v.isos.map((p) => p.split("/").pop()).join(", ") || "None") : "—") },
      {
        title: "", width: "22%", className: "actions",
        render: (v) => h("div", { class: "row" },
          v.running
            ? ui.iconButton("power", `Shut down ${v.id}`, (e) => vmAction(e.currentTarget, "winShutdown", v.id, `Sent shutdown to ${v.id}`))
            : ui.iconButton("play", `Start ${v.id} with checked media`, (e) => vmAction(e.currentTarget, "winStart", v.id, `Started ${v.id}`)),
          v.running ? ui.iconButton("stop", `Power off ${v.id}`, (e) => vmAction(e.currentTarget, "winPowerOff", v.id, `Powered off ${v.id}`)) : null,
          v.running ? null : v.display === "virtio-gpu"
            ? ui.iconButton("display", `Use basic display for ${v.id}`, (e) => setDisplay(e.currentTarget, v.id, "ramfb", "Basic display (ramfb)"))
            : ui.iconButton("display", `Use VirtIO GPU display for ${v.id}`, (e) => setDisplay(e.currentTarget, v.id, "virtio-gpu", "VirtIO GPU")),
          ui.iconButton("terminal", `Show QEMU log for ${v.id}`, () => showLog(v.id)),
          v.running ? null : ui.iconButton("trash", `Delete ${v.id}`, (e) => vmAction(e.currentTarget, "winDelete", v.id, `Deleted ${v.id}`))),
      },
    ], vms, { rowKey: (v) => v.id }));
  }

  function render() {
    if (error && !state) { vmSlot.replaceChildren(h("div", { class: "group" }, h("p", { style: { color: "var(--red)" } }, error))); return; }
    if (!state) { vmSlot.replaceChildren(ui.loading()); return; }
    renderTools();
    renderMedia();
    renderVMs();
  }

  render();
  refresh();
  loadCatalog();
  return { update() {}, destroy() { clearTimeout(timer); } };
};
