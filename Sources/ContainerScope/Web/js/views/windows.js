"use strict";
CS.views = CS.views || {};

/*
  Windows: Windows 11 on ARM guests on QEMU + Hypervisor.framework.
  Installer ISOs download into a temporary folder and are cleaned up from here once setup is done.
*/
CS.views.windows = function windows(root) {
  const { h, fmt, ui } = CS;
  const MS_PAGE = "https://www.microsoft.com/software-download/windows11arm64";
  const INSIDER_PAGE = "https://www.microsoft.com/en-us/software-download/windowsinsiderpreviewARM64";
  const INSIDER_JOIN = "https://www.microsoft.com/en-us/windowsinsider/";
  const UUP_DUMP = "https://uupdump.net/";
  const ALL_DRIVERS = "Get-ChildItem E:\\ -Recurse -Filter *.inf | Where-Object FullName -match '\\\\w11\\\\ARM64\\\\' | ForEach-Object { pnputil /add-driver $_.FullName /install }";
  const DISPLAY_DRIVER = "pnputil /add-driver E:\\viogpudo\\w11\\ARM64\\viogpudo.inf /install";
  const NET_MODES = [["nat", "NAT"], ["forward", "NAT + Port Forwarding"], ["none", "Isolated"]];
  const NET_HINTS = {
    nat: "Windows reaches the internet through the Mac (QEMU user-mode NAT; Windows gets 10.0.2.15). Nothing on the Mac can connect in.",
    forward: "NAT, plus TCP ports on the Mac (127.0.0.1 only) forwarded into Windows. Mac ports must be 1024–65535 and not used by another app or VM. RDP needs Remote Desktop turned on in Windows; SSH needs OpenSSH Server.",
    none: "No network adapter at all: Windows stays offline.",
  };
  const PRESETS = [["RDP", 3389, 3389], ["SSH", 2222, 22]];
  let state = null;
  let error = null;
  let timer = null;
  let source = "microsoft";
  let virtioChannel = "stable";
  const attach = {};          // iso path → attach at next boot (default on)
  const extraISOs = [];       // ISOs picked from elsewhere on disk (never cleaned up)

  const field = (label, control, wide) => h("label", { class: `field${wide ? " wide" : ""}` }, h("span", {}, label), control);
  const open = (url) => () => CS.call("openURL", { url });
  const copyBlock = (text) => h("div", { class: "copy-block" },
    h("pre", { class: "console" }, text),
    ui.iconButton("keyboard", "Type into the running VM", (e) => typeInto(e.currentTarget, text), ""),
    ui.iconButton("copy", "Copy", () => { navigator.clipboard.writeText(text); CS.toast("Copied"); }, ""));
  /* Types text into the one running VM as keystrokes; Windows on ARM has no clipboard agent. */
  async function typeInto(button, text) {
    const running = (state?.vms || []).filter((v) => v.running);
    if (running.length !== 1) {
      CS.toast(running.length ? "Several VMs are running" : "No VM is running",
        running.length ? "Use Type Mac Clipboard on the VM you want instead." : "Start the VM, click where the text should go, then try again.", "error");
      return;
    }
    await CS.act(button, "winType", { id: running[0].id, text }, `Typed into ${running[0].id}`);
  }
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
  const createNetwork = networkEditor({ mode: "nat", forwards: [] });

  const toolsSlot = h("div");
  const sourceSlot = h("div", { class: "stack-tight" });
  const mediaSlot = h("div");
  const mediaSummary = h("span", { class: "summary" });
  const vmSlot = h("div");
  const vmSummary = h("span", { class: "summary" });
  const editSlot = h("div");
  const logSlot = h("div");

  /* Each install source: a title, why/when to use it, and its controls. */
  const SOURCES = [
    ["microsoft", "Microsoft", () => [
      explain("Windows 11 on ARM · official release",
        "The current Windows 11 Arm64 ISO from Microsoft's download page, in every edition and language Microsoft offers. ContainerScope asks Microsoft for a signed link when you click Download (valid 24 hours), and the file comes straight from Microsoft's servers."),
      h("div", { class: "row wrap" }, field("Windows on ARM", editionSelect, true), field("Language", languageSelect), windowsButton),
      catalogStatus]],
    ["insider", "Insider Preview", () => [
      explain("Windows Insider Preview · ARM64",
        "Pre-release Windows 11 on ARM builds from Microsoft. Microsoft only shows these ISOs to Windows Insider members signed in with a Microsoft account, so ContainerScope can't download them for you. Open the page in your browser, sign in, download the ARM64 ISO, then choose the downloaded file here."),
      h("div", { class: "row wrap" },
        ui.button("Open Insider ARM64 Downloads", { onClick: open(INSIDER_PAGE) }),
        ui.button("Join Windows Insider", { kind: "plain", onClick: open(INSIDER_JOIN) }),
        h("span", { class: "spacer" }),
        ui.button("Choose Downloaded ISO…", { onClick: (e) => chooseISO(e.currentTarget) }))]],
    ["link", "Link", () => [
      explain("Direct download link",
        "Any https:// link to an ARM64 .iso, such as the 24-hour link Microsoft's download page gives you after picking a language. It downloads into the temporary folder below."),
      h("div", { class: "row wrap" }, field("Windows ISO link", urlInput, true),
        ui.button("Download", { icon: "download", onClick: (e) => download(e.currentTarget, "isoDownload", { url: urlInput.value }) }),
        ui.button("Open Microsoft Download Page", { kind: "plain", onClick: open(MS_PAGE) }))]],
    ["disk", "ISO on Disk", () => [
      explain("An ISO you already have",
        "Use a Windows 11 ARM64 or driver ISO that's already on this Mac. It's attached in place: never copied, and never deleted by Clean Up."),
      h("div", { class: "row" }, ui.button("Choose ISO…", { onClick: (e) => chooseISO(e.currentTarget) }))]],
    ["uup", "UUP dump", () => [
      explain("UUP dump · community tool",
        "uupdump.net lists the Windows builds Microsoft's update servers deliver, including Insider builds without signing in, and gives you a script that downloads those files from Microsoft and assembles an ISO on your Mac. It's run by volunteers, not Microsoft, and ContainerScope doesn't run or check it. Pick an arm64 build; the macOS script needs aria2, cabextract, wimlib, chntpw and cdrtools from Homebrew. Then choose the ISO it builds."),
      h("div", { class: "row wrap" },
        ui.button("Open UUP dump", { onClick: open(UUP_DUMP) }),
        h("span", { class: "spacer" }),
        ui.button("Choose Built ISO…", { onClick: (e) => chooseISO(e.currentTarget) }))]],
  ];

  root.replaceChildren(h("div", { class: "stack" },
    toolsSlot,
    h("section", {},
      h("div", { class: "section-header" }, h("h2", {}, "Installer Media"), mediaSummary, h("div", { class: "spacer" }),
        ui.button("Clean Up", { icon: "sweep", title: "Delete downloaded ISOs from the temporary folder", onClick: (e) => cleanup(e.currentTarget) })),
      h("div", { class: "stack-tight" },
        h("div", { class: "group stack-tight" },
          ui.segmented(SOURCES.map(([key, label]) => [key, label]), source, (key) => { source = key; renderSource(); }, "Windows install source"),
          sourceSlot),
        driversGroup(),
        mediaSlot)),
    h("section", {},
      ui.sectionHeader("New Windows VM", "Windows 11 on ARM · Hypervisor.framework · UEFI · TPM 2.0 · NVMe"),
      h("div", { class: "group stack-tight" },
        h("div", { class: "form-grid" }, field("Name", name), field("CPUs", cpus), field("Memory (GB)", memory), field("Disk (GB)", disk)),
        h("div", { class: "field" }, h("span", {}, "Network"), createNetwork.el),
        h("div", { class: "row" }, h("span", { class: "secondary" }, "The disk grows on demand; 64 GB is Windows 11's minimum."), h("span", { class: "spacer" }), createButton))),
    h("section", {}, h("div", { class: "section-header" }, h("h2", {}, "Virtual Machines"), vmSummary), vmSlot),
    editSlot,
    logSlot,
    h("section", {},
      ui.sectionHeader("Setup Notes"),
      h("div", { class: "group stack-tight" },
        h("p", {}, "Press any key in the VM window when it says ", h("code", {}, "Press any key to boot from CD or DVD"), "."),
        h("p", {}, "To get online during setup, attach the VirtIO drivers ISO, choose ", h("code", {}, "Install driver"), " on the network screen and pick ", h("code", {}, "E:\\NetKVM\\w11\\ARM64"), ". Or press ", h("code", {}, "Shift+F10"), ", run ", h("code", {}, "OOBE\\BYPASSNRO"), ", and choose “I don't have internet”."),
        h("p", {}, "After first login, install the rest of the ARM64 VirtIO drivers with the commands under VirtIO Drivers above. ", h("code", {}, "virtio-win-guest-tools.exe"), " is x64-only."),
        h("p", {}, "Then shut down and switch the VM's display to VirtIO GPU so the window can be resized and Windows follows its size. Basic display (ramfb) has a fixed size; the window then only scales the picture."),
        h("p", {}, "Once Windows is installed, start the VM with no media attached and use Clean Up to delete the ISOs.")))));

  function explain(title, text) {
    return h("div", {}, h("strong", {}, title), h("p", { class: "secondary", style: { margin: "4px 0 0" } }, text));
  }

  function renderSource() {
    sourceSlot.replaceChildren(...SOURCES.find(([key]) => key === source)[2]());
  }

  /* The VirtIO ISO carries every ARM64 driver this VM's virtual hardware needs. */
  function driversGroup() {
    const downloadButton = ui.button("Download VirtIO Drivers", { icon: "download", onClick: (e) => download(e.currentTarget, "isoDownloadVirtio", { channel: virtioChannel }) });
    return h("div", { class: "group stack-tight" },
      h("div", { class: "row wrap" },
        h("strong", {}, "VirtIO Drivers · ARM64"),
        h("span", { class: "spacer" }),
        ui.segmented([["stable", "Stable"], ["latest", "Latest"]], virtioChannel, (key) => { virtioChannel = key; downloadButton.title = state?.virtio?.[key] || ""; }, "VirtIO driver channel"),
        downloadButton),
      h("p", { class: "secondary", style: { margin: 0 } },
        "Windows 11 on ARM has no built-in driver for this VM's network adapter or VirtIO GPU display. Fedora's virtio-win ISO has ARM64 drivers for both: ",
        h("strong", {}, "NetKVM"), " (network) and ", h("strong", {}, "viogpudo"), " (display and video), plus viostor and vioscsi (storage), Balloon (memory), vioserial, viorng, vioinput, viomem, pvpanic, viosock and viofs. ",
        "Stable is the tested release, Latest the newest build; they save as virtio-win-stable.iso and virtio-win-latest.iso."),
      h("p", { style: { margin: 0 } }, h("strong", {}, "Don't run virtio-win-guest-tools.exe or the .msi installers"), " on the CD: they're x64-only and fail on Windows on ARM with error 0x80070643."),
      h("p", { style: { margin: 0 } }, "Install every ARM64 driver (PowerShell as administrator in Windows, VirtIO CD as ", h("code", {}, "E:"), "):"),
      copyBlock(ALL_DRIVERS),
      h("p", { style: { margin: 0 } }, "Only the display driver, needed before switching a VM to VirtIO GPU:"),
      copyBlock(DISPLAY_DRIVER),
      h("p", { class: "secondary", style: { margin: 0 } }, "Each driver sits in ", h("code", {}, "<driver>\\w11\\ARM64"), " on the ISO, for example ", h("code", {}, "E:\\viogpudo\\w11\\ARM64"), " and ", h("code", {}, "E:\\NetKVM\\w11\\ARM64"), ". If Windows gave the CD another letter, replace ", h("code", {}, "E:"), "."));
  }

  /* Network settings for a VM: mode, forwarding rules (forward mode), and the adapter it implies. */
  function networkEditor(initial, ownerId) {
    let mode = initial.mode || "nat";
    const rules = (initial.forwards || []).map((f) => ({ host: String(f.host), guest: String(f.guest) }));
    const hint = h("p", { class: "secondary", style: { margin: 0 } });
    const adapter = h("p", { class: "secondary", style: { margin: 0 } },
      "Adapter: VirtIO network (virtio-net-pci). Windows 11 on ARM has no built-in driver for it or for any other adapter QEMU emulates here, so install NetKVM from the VirtIO drivers.");
    const rulesSlot = h("div", { class: "stack-tight" });
    const el = h("div", { class: "stack-tight" },
      h("div", { class: "row" }, ui.segmented(NET_MODES, mode, (key) => {
        mode = key;
        if (key === "forward" && !rules.length) addRule(3389, 3389);
        draw();
      }, "Network mode")),
      hint, rulesSlot, adapter);

    /* Mac ports taken by this editor's other rules or by another VM. */
    function usedPorts() {
      const taken = new Set(rules.map((r) => Number(r.host)));
      for (const vm of state?.vms || []) {
        if (vm.id !== ownerId && vm.network?.mode === "forward") vm.network.forwards.forEach((f) => taken.add(f.host));
      }
      return taken;
    }
    function addRule(host, guest) {
      const taken = usedPorts();
      while (taken.has(host) && host < 65535) host++;
      rules.push({ host: String(host), guest: String(guest) });
    }
    const portInput = (rule, key, min, label) => h("input", {
      type: "number", min, max: 65535, value: rule[key], "aria-label": label, style: { width: "110px" },
      oninput: (e) => { rule[key] = e.currentTarget.value.trim(); },
    });
    function draw() {
      hint.textContent = NET_HINTS[mode];
      adapter.hidden = mode === "none";
      if (mode !== "forward") { rulesSlot.replaceChildren(); return; }
      rulesSlot.replaceChildren(
        ...rules.map((rule, index) => h("div", { class: "row wrap" },
          field("Mac port (127.0.0.1)", portInput(rule, "host", 1024, `Mac port for rule ${index + 1}`)),
          h("span", { class: "secondary", style: { alignSelf: "flex-end", paddingBottom: "6px" } }, "→"),
          field("Windows port", portInput(rule, "guest", 1, `Windows port for rule ${index + 1}`)),
          h("span", { style: { alignSelf: "flex-end" } }, ui.iconButton("trash", `Remove rule ${index + 1}`, () => { rules.splice(index, 1); draw(); })))),
        h("div", { class: "row wrap" },
          ...PRESETS.map(([label, host, guest]) => ui.button(`Add ${label} (${guest})`, { kind: "plain", onClick: () => { addRule(host, guest); draw(); } })),
          ui.button("Add Custom TCP Rule", { kind: "plain", onClick: () => { addRule(8080, 80); draw(); } })));
    }
    draw();
    return { el, params: () => ({ network: mode, forwards: mode === "forward" ? rules.map((r) => `${r.host}:${r.guest}`) : [] }) };
  }

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
    const params = { id: name.value.trim(), cpus: Number(cpus.value), memoryGB: Number(memory.value), diskGB: Number(disk.value), ...createNetwork.params() };
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

  /* Network changes apply at the next start, so they're only offered while the VM is shut down. */
  function editNetwork(vm) {
    const editor = networkEditor(vm.network || { mode: "nat", forwards: [] }, vm.id);
    const close = () => editSlot.replaceChildren();
    const save = ui.button("Save", { kind: "prominent", onClick: async () => {
      if ((await CS.act(save, "winSetNetwork", { id: vm.id, ...editor.params() }, `${vm.id} network saved · applies at next start`)).ok) { close(); refresh(); }
    } });
    editSlot.replaceChildren(h("section", {},
      ui.sectionHeader(`Network · ${vm.id}`, "Applies the next time the VM starts", ui.button("Cancel", { kind: "plain", onClick: close }), save),
      h("div", { class: "group stack-tight" }, editor.el)));
  }

  /* Everything a Windows VM needs ships inside the app; this only reports what's bundled. */
  function renderTools() {
    const v = state.versions || {};
    const item = (ok, label, version) => h("span", { class: `check ${ok ? "pass" : "fail"}` }, h("span", {}, ok ? "✓" : "✕"), ` ${label}`, version ? h("span", { class: "secondary" }, ` ${version}`) : null);
    const broken = !state.qemu || !state.swtpm || !state.firmware;
    toolsSlot.replaceChildren(h("div", { class: "stack-tight" },
      h("div", { class: "checks" },
        item(state.qemu, "QEMU with Hypervisor.framework", v.qemu),
        item(state.firmware, "UEFI Secure Boot (Microsoft keys)", v.firmware),
        item(state.swtpm, "swtpm TPM 2.0", v.swtpm)),
      broken ? h("div", { class: "callout warning" }, "Part of the bundled Windows tooling is missing from this copy of ContainerScope. Download the app again from the Releases page.") : null));
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

  async function setDisplay(id, display) {
    const label = display === "virtio-gpu"
      ? "VirtIO GPU. If viogpudo isn't installed in Windows yet (including during Setup), the window freezes on the boot logo: shut down and switch back to Basic"
      : "Basic display (ramfb)";
    await CS.act(null, "winSetDisplay", { id, display }, `${id} will use ${label} on next start`);
    refresh();
  }

  /* Display switch with the driver it depends on right underneath. */
  function displayCell(v) {
    const note = v.display === "virtio-gpu"
      ? "Only after viogpudo is installed in Windows · not for Setup; frozen boot logo = switch back to Basic"
      : "Fixed size · no driver needed · use for Setup";
    const control = v.running
      ? h("span", { class: "primary-cell" }, v.display === "virtio-gpu" ? "VirtIO GPU" : "Basic (ramfb)")
      : ui.segmented([["ramfb", "Basic"], ["virtio-gpu", "VirtIO GPU"]], v.display, (key) => setDisplay(v.id, key), `Display for ${v.id}`);
    return [control, h("span", { class: "sub" }, note)];
  }

  function networkText(net) {
    if (!net || net.mode === "nat") return ["NAT", "VirtIO adapter"];
    if (net.mode === "none") return ["Isolated", "No adapter"];
    return ["NAT + forwarding", net.forwards.map((f) => f.host === f.guest ? `${f.host}` : `${f.host}→${f.guest}`).join(", ")];
  }

  function renderVMs() {
    const vms = state.vms;
    vmSummary.textContent = `${vms.filter((v) => v.running).length} running · ${vms.length} total`;
    if (!vms.length) { vmSlot.replaceChildren(h("div", { class: "group" }, ui.empty("box", "No Windows VMs", "Download the Windows ISO and VirtIO drivers, then create a VM above."))); return; }
    ui.showTable(vmSlot, ui.table([
      { title: "Name", width: "14%", render: (v) => [h("span", { class: "primary-cell" }, v.id), h("span", { class: "sub" }, ui.status(v.running ? "running" : "stopped"))] },
      { title: "Resources", width: "12%", render: (v) => [h("span", {}, `${v.cpus} CPU · ${v.memoryGB} GB`), h("span", { class: "sub" }, `${fmt.bytes(v.diskUsed)} of ${v.diskGB} GB`)] },
      { title: "Display", width: "22%", render: displayCell },
      { title: "Network", width: "16%", render: (v) => { const [main, sub] = networkText(v.network); return [h("span", {}, main), h("span", { class: "sub truncate", title: sub }, sub)]; } },
      { title: "Media", width: "18%", render: (v) => h("span", { class: "secondary truncate" }, v.running ? (v.isos.map((p) => p.split("/").pop()).join(", ") || "None") : "—") },
      {
        title: "", width: "18%", className: "actions",
        render: (v) => h("div", { class: "row" },
          v.running
            ? ui.iconButton("power", `Shut down ${v.id}`, (e) => vmAction(e.currentTarget, "winShutdown", v.id, `Sent shutdown to ${v.id}`))
            : ui.iconButton("play", `Start ${v.id} with checked media`, (e) => vmAction(e.currentTarget, "winStart", v.id, `Started ${v.id}`)),
          v.running ? ui.iconButton("stop", `Power off ${v.id}`, (e) => vmAction(e.currentTarget, "winPowerOff", v.id, `Powered off ${v.id}`)) : null,
          v.running ? ui.iconButton("keyboard", `Type Mac Clipboard into ${v.id} (US keyboard layout)`, (e) => vmAction(e.currentTarget, "winType", v.id, `Typed clipboard into ${v.id}`)) : null,
          v.running ? null : ui.iconButton("network", `Change network for ${v.id}`, () => editNetwork(v)),
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

  renderSource();
  render();
  refresh();
  loadCatalog();
  return { update() {}, destroy() { clearTimeout(timer); } };
};
