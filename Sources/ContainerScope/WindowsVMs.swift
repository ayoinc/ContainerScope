import Foundation

/// Windows on ARM guests run on QEMU with Apple's Hypervisor.framework (`-accel hvf`), Secure Boot
/// UEFI and a software TPM 2.0 (swtpm) for Windows 11, all bundled in the app (see `Bundled`).
/// Install media is downloaded into a temporary folder that the user cleans up once setup has finished.
@MainActor
final class WindowsVMs {
    static let shared = WindowsVMs()

    /// Fedora's VirtIO driver ISOs. Both carry ARM64 drivers under `<driver>\w11\ARM64`: viogpudo
    /// (display), NetKVM (network), Balloon, vioserial, viorng, viofs and more. Each channel downloads
    /// under its own name so stable and latest can sit side by side in the temp folder.
    static let virtioChannels: [String: URL] = [
        "stable": URL(string: "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso")!,
        "latest": URL(string: "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win.iso")!,
    ]

    let vmRoot: URL
    let mediaDir: URL
    /// Secure Boot UEFI with Microsoft keys enrolled (Ubuntu's AAVMF build), expanded from the bundle.
    let firmwareDir: URL
    private var secureBootCode: URL { firmwareDir.appendingPathComponent("AAVMF_CODE.ms.fd") }
    private var secureBootVars: URL { firmwareDir.appendingPathComponent("AAVMF_VARS.ms.fd") }
    private var downloads: [String: Download] = [:]

    private struct Download {
        let source: URL
        let task: URLSessionDownloadTask
        var state = "downloading"   // downloading | done | failed
        var error: String?
    }

    private init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        vmRoot = support.appendingPathComponent("ContainerScope/Windows", isDirectory: true)
        firmwareDir = support.appendingPathComponent("ContainerScope/Firmware", isDirectory: true)
        mediaDir = FileManager.default.temporaryDirectory.appendingPathComponent("ContainerScope-ISO", isDirectory: true)
    }

    // MARK: Tooling

    private static func tool(_ name: String) throws -> URL {
        guard let url = Bundled.qemuTool(name) else {
            throw CLIError(message: "\(name) is missing from the app bundle. Reinstall ContainerScope.")
        }
        return url
    }

    /// QEMU's virt machine needs 64 MiB pflash images. The bundle ships them with the trailing zero
    /// padding trimmed; this restores it once per firmware version. Truncating extends the file
    /// sparsely, so the padding takes no disk space, and rename(2) swaps files atomically, so a
    /// running VM keeps its open copy.
    private func ensureFirmware() throws {
        let fm = FileManager.default
        let source = Bundled.firmware
        guard let version = try? String(contentsOf: source.appendingPathComponent("VERSION"), encoding: .utf8) else {
            throw CLIError(message: "Secure Boot firmware is missing from the app bundle. Reinstall ContainerScope.")
        }
        let stamp = firmwareDir.appendingPathComponent("VERSION")
        let current = [secureBootCode, secureBootVars].allSatisfy { fm.fileExists(atPath: $0.path) }
        if current, (try? String(contentsOf: stamp, encoding: .utf8)) == version { return }
        try fm.createDirectory(at: firmwareDir, withIntermediateDirectories: true)
        for target in [secureBootCode, secureBootVars] {
            let temp = firmwareDir.appendingPathComponent(".\(target.lastPathComponent).new")
            try? fm.removeItem(at: temp)
            try fm.copyItem(at: source.appendingPathComponent(target.lastPathComponent), to: temp)
            let handle = try FileHandle(forWritingTo: temp)
            try handle.truncate(atOffset: 64 << 20)
            try handle.close()
            guard rename(temp.path, target.path) == 0 else {
                throw CLIError(message: "Could not install \(target.lastPathComponent): \(String(cString: strerror(errno)))")
            }
        }
        try version.write(to: stamp, atomically: true, encoding: .utf8)
    }

    // MARK: Status

    func statusJSON() throws -> String {
        let fm = FileManager.default
        let media = ((try? fm.contentsOfDirectory(at: mediaDir, includingPropertiesForKeys: [.fileSizeKey])) ?? [])
            .filter { $0.pathExtension.lowercased() == "iso" }
        var mediaItems: [[String: Any]] = media.map { url in
            var item: [String: Any] = ["name": url.lastPathComponent, "path": url.path, "state": "done",
                                       "size": (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0]
            item["inUse"] = runningVMs().contains { $0.isos.contains(url.path) }
            return item
        }
        for (name, d) in downloads where d.state != "done" {
            mediaItems.append(["name": name, "path": mediaDir.appendingPathComponent(name).path, "state": d.state,
                               "received": d.task.countOfBytesReceived, "total": max(d.task.countOfBytesExpectedToReceive, 0),
                               "error": d.error ?? "", "source": d.source.absoluteString, "inUse": false])
        }
        let result: [String: Any] = [
            "qemu": Bundled.qemuTool("qemu-system-aarch64") != nil,
            "swtpm": Bundled.qemuTool("swtpm") != nil,
            "firmware": FileManager.default.fileExists(atPath: Bundled.firmware.appendingPathComponent("VERSION").path),
            "versions": Bundled.versions,
            "mediaDir": mediaDir.path,
            "vmRoot": vmRoot.path,
            "media": mediaItems.sorted { ($0["name"] as! String) < ($1["name"] as! String) },
            "vms": try vms().map(\.json),
            "virtio": Self.virtioChannels.mapValues(\.absoluteString),
        ]
        return String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
    }

    // MARK: Install media

    /// Starts a background download into the temp media folder, saved as `fileName` (default: the
    /// link's last path component); progress is reported by `statusJSON`.
    func download(_ source: URL, as fileName: String? = nil) throws -> String {
        guard source.scheme == "https" else { throw CLIError(message: "Only https:// download links are allowed") }
        let name = fileName ?? source.lastPathComponent
        guard name.lowercased().hasSuffix(".iso"), Self.safeFileName(name) else {
            throw CLIError(message: "The link must point to an .iso file")
        }
        if let existing = downloads[name], existing.state == "downloading" { throw CLIError(message: "\(name) is already downloading") }
        try FileManager.default.createDirectory(at: mediaDir, withIntermediateDirectories: true)
        let destination = mediaDir.appendingPathComponent(name)

        let task = Self.session.downloadTask(with: source) { [weak self] location, response, error in
            // The temporary file vanishes when this handler returns, so move it synchronously here.
            var failure = error?.localizedDescription
            if failure == nil, let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                failure = "Server answered HTTP \(http.statusCode) (download links from Microsoft expire after 24 hours)"
            }
            if failure == nil, let location {
                do {
                    try? FileManager.default.removeItem(at: destination)
                    try FileManager.default.moveItem(at: location, to: destination)
                } catch {
                    failure = error.localizedDescription
                }
            }
            Task { @MainActor in
                guard var entry = self?.downloads[name] else { return }
                if let failure, (error as? URLError)?.code != .cancelled {
                    entry.state = "failed"
                    entry.error = failure
                    self?.downloads[name] = entry
                } else if failure == nil {
                    self?.downloads[name] = nil      // finished files are listed from disk
                } else {
                    self?.downloads[name] = nil      // cancelled
                }
            }
        }
        downloads[name] = Download(source: source, task: task)
        task.resume()
        return name
    }

    func cancelDownload(_ name: String) {
        downloads[name]?.task.cancel()
        downloads[name] = nil
    }

    /// Deletes one temp ISO, or every one not attached to a running VM. Returns bytes freed.
    func cleanMedia(only name: String?) throws -> Int {
        let fm = FileManager.default
        let busy = Set(runningVMs().flatMap(\.isos))
        var freed = 0
        let files = ((try? fm.contentsOfDirectory(at: mediaDir, includingPropertiesForKeys: [.fileSizeKey])) ?? [])
            .filter { name == nil || $0.lastPathComponent == name }
        if let name, files.isEmpty, downloads[name] != nil { downloads[name] = nil; return 0 }
        for url in files where !busy.contains(url.path) {
            freed += (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            try fm.removeItem(at: url)
            downloads[url.lastPathComponent] = nil
        }
        if let name, files.contains(where: { busy.contains($0.path) }) {
            throw CLIError(message: "\(name) is attached to a running VM. Shut it down first.")
        }
        downloads = downloads.filter { $0.value.state == "downloading" }
        return freed
    }

    // MARK: Virtual machines

    struct VM {
        let id: String
        let dir: URL
        let cpus: Int
        let memoryGB: Int
        let diskGB: Int
        /// "ramfb" (fixed-size framebuffer Windows drives with no extra driver) or "virtio-gpu"
        /// (resizable; needs viogpudo from virtio-win installed in Windows first).
        var display = "ramfb"
        var network = Network()
        /// Per-VM MAC address. QEMU's default (52:54:00:12:34:56) is shared by every QEMU guest, and
        /// Windows Autopilot can mistake it for an enrolled device and demand an unrelated work sign-in.
        var mac = ""
        var isos: [String] = []
        var pid: Int32?

        var running: Bool { pid != nil }

        var json: [String: Any] {
            let disk = dir.appendingPathComponent("disk.qcow2")
            let used = (try? disk.resourceValues(forKeys: [.totalFileAllocatedSizeKey]).totalFileAllocatedSize) ?? 0
            return ["id": id, "cpus": cpus, "memoryGB": memoryGB, "diskGB": diskGB, "diskUsed": used,
                    "display": display, "network": network.json, "mac": mac, "running": running, "isos": isos, "dir": dir.path]
        }
    }

    /// TCP port forwarded from 127.0.0.1 on the Mac to the guest.
    struct Forward: Equatable {
        let host: Int
        let guest: Int
    }

    /// "nat": QEMU user networking (outbound only). "forward": NAT plus host→guest TCP forwards.
    /// "none": no network adapter at all. The adapter is always virtio-net-pci: Windows 11 ARM64 has
    /// no inbox driver for any NIC QEMU can emulate on `virt`, so NetKVM from virtio-win is needed.
    struct Network {
        var mode = "nat"
        var forwards: [Forward] = []

        var json: [String: Any] { ["mode": mode, "forwards": forwards.map { ["host": $0.host, "guest": $0.guest] }] }

        /// Validates a mode plus "host:guest" rules (forward mode only).
        static func parse(mode: String?, forwards: [String]?) throws -> Network {
            let mode = mode ?? "nat"
            guard ["nat", "forward", "none"].contains(mode) else { throw CLIError(message: "Unknown network mode \(mode)") }
            guard mode == "forward" else { return Network(mode: mode) }
            var rules: [Forward] = []
            for text in forwards ?? [] {
                let parts = text.split(separator: ":", omittingEmptySubsequences: false)
                guard parts.count == 2, let host = Int(parts[0]), let guest = Int(parts[1]),
                      (1024...65535).contains(host), (1...65535).contains(guest) else {
                    throw CLIError(message: "Invalid rule “\(text)”: Mac ports must be 1024–65535 and Windows ports 1–65535")
                }
                guard !rules.contains(where: { $0.host == host }) else {
                    throw CLIError(message: "Mac port \(host) is used by two rules. Each rule needs its own Mac port.")
                }
                rules.append(Forward(host: host, guest: guest))
            }
            guard !rules.isEmpty else { throw CLIError(message: "Add at least one port forwarding rule, or choose NAT") }
            guard rules.count <= 16 else { throw CLIError(message: "Use 16 port forwarding rules or fewer") }
            return Network(mode: mode, forwards: rules)
        }
    }

    private static func randomMAC() -> String {
        "52:54:00:" + (0..<3).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined(separator: ":")
    }

    /// Stable MAC for VMs created before MACs were stored, unique per user and VM (FNV-1a of the
    /// VM folder path and creation time), so no config file is rewritten.
    private static func derivedMAC(_ seed: String) -> String {
        var hash: UInt32 = 2_166_136_261
        for byte in seed.utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
        return String(format: "52:54:00:%02x:%02x:%02x", (hash >> 16) & 0xff, (hash >> 8) & 0xff, hash & 0xff)
    }

    private static func validMAC(_ mac: String) -> Bool {
        mac.range(of: "^([0-9a-f]{2}:){5}[0-9a-f]{2}$", options: .regularExpression) != nil
    }

    /// Two VMs may not claim the same Mac port, even when only one runs at a time, so a rule never
    /// fails at start because of another VM's configuration.
    private func checkForwardConflicts(_ network: Network, id: String) throws {
        for other in try vms() where other.id != id && other.network.mode == "forward" {
            if let clash = network.forwards.first(where: { rule in other.network.forwards.contains { $0.host == rule.host } }) {
                throw CLIError(message: "Mac port \(clash.host) is already forwarded to \(other.id). Choose another Mac port.")
            }
        }
    }

    /// True when nothing on this Mac is listening on 127.0.0.1:`port` (or the wildcard address).
    private static func hostPortFree(_ port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return true }
        defer { close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(port).bigEndian)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        } == 0
    }

    private func vms() throws -> [VM] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: vmRoot.path) else { return [] }
        return try fm.contentsOfDirectory(at: vmRoot, includingPropertiesForKeys: nil).compactMap(load).sorted { $0.id < $1.id }
    }

    private func load(_ dir: URL) -> VM? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("vm.json")),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        var vm = VM(id: dir.lastPathComponent, dir: dir, cpus: config["cpus"] as? Int ?? 4,
                    memoryGB: config["memoryGB"] as? Int ?? 8, diskGB: config["diskGB"] as? Int ?? 64)
        if config["display"] as? String == "virtio-gpu" { vm.display = "virtio-gpu" }
        // VMs without a network key keep the original default: NAT with virtio-net-pci.
        if let net = config["network"] as? [String: Any],
           let parsed = try? Network.parse(mode: net["mode"] as? String,
                                           forwards: (net["forwards"] as? [[String: Int]])?.map { "\($0["host"] ?? 0):\($0["guest"] ?? 0)" }) {
            vm.network = parsed
        }
        if let mac = config["mac"] as? String, Self.validMAC(mac) {
            vm.mac = mac
        } else {
            vm.mac = Self.derivedMAC(dir.path + (config["created"] as? String ?? ""))
        }
        if let text = try? String(contentsOf: dir.appendingPathComponent("qemu.pid"), encoding: .utf8),
           let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)), kill(pid, 0) == 0 {
            vm.pid = pid
            vm.isos = (try? String(contentsOf: dir.appendingPathComponent("media.txt"), encoding: .utf8))?
                .split(separator: "\n").map(String.init) ?? []
        }
        return vm
    }

    private func runningVMs() -> [VM] { ((try? vms()) ?? []).filter(\.running) }

    private func vm(_ id: String) throws -> VM {
        guard let vm = load(vmRoot.appendingPathComponent(id, isDirectory: true)) else { throw CLIError(message: "No Windows VM named \(id)") }
        return vm
    }

    func create(id: String, cpus: Int, memoryGB: Int, diskGB: Int, network: Network) async throws -> String {
        let qemuImg = try Self.tool("qemu-img")
        try ensureFirmware()
        let vars = secureBootVars
        // UNIX socket paths are limited to 104 bytes, so keep names short.
        guard id.utf8.count <= 24 else { throw CLIError(message: "Use a name of 24 characters or fewer") }
        try checkForwardConflicts(network, id: id)
        let dir = vmRoot.appendingPathComponent(id, isDirectory: true)
        let fm = FileManager.default
        guard !fm.fileExists(atPath: dir.path) else { throw CLIError(message: "\(id) already exists") }
        try fm.createDirectory(at: dir.appendingPathComponent("tpm"), withIntermediateDirectories: true)
        do {
            // Per-VM copy of the UEFI variable store (Microsoft keys enrolled) so boot entries and Secure Boot state persist.
            try fm.copyItem(at: vars, to: dir.appendingPathComponent("vars.fd"))
            _ = try await ContainerCLI.run(qemuImg, ["create", "-f", "qcow2", dir.appendingPathComponent("disk.qcow2").path, "\(diskGB)G"], timeout: 60)
            let config: [String: Any] = ["cpus": cpus, "memoryGB": memoryGB, "diskGB": diskGB, "network": network.json,
                                         "mac": Self.randomMAC(), "created": ISO8601DateFormatter().string(from: Date())]
            try JSONSerialization.data(withJSONObject: config).write(to: dir.appendingPathComponent("vm.json"))
        } catch {
            try? fm.removeItem(at: dir)
            throw error
        }
        return id
    }

    func start(id: String, isos: [String]) async throws -> String {
        let qemu = try Self.tool("qemu-system-aarch64"), swtpm = try Self.tool("swtpm")
        try ensureFirmware()
        let code = secureBootCode
        let vm = try vm(id)
        guard !vm.running else { throw CLIError(message: "\(id) is already running") }
        if let busy = vm.network.forwards.first(where: { !Self.hostPortFree($0.host) }) {
            throw CLIError(message: "Mac port \(busy.host) is already in use by another app, so it can't be forwarded to Windows port \(busy.guest). Free the port or change \(id)'s network rules, then start again.")
        }
        let dir = vm.dir
        let path = { (name: String) in dir.appendingPathComponent(name).path }
        let fm = FileManager.default
        killTPM(dir)    // a previous failed start may have left one waiting for a connection
        for leftover in ["tpm/swtpm.sock", "tpm/swtpm.pid", "monitor.sock", "qemu.pid"] { try? fm.removeItem(atPath: path(leftover)) }

        // Software TPM 2.0 (Windows 11 requirement); exits on its own when QEMU disconnects.
        _ = try await ContainerCLI.run(swtpm, [
            "socket", "--tpm2", "--daemon", "--terminate",
            "--tpmstate", "dir=\(path("tpm"))",
            "--ctrl", "type=unixio,path=\(path("tpm/swtpm.sock"))",
            "--pid", "file=\(path("tpm/swtpm.pid"))",
            "--log", "file=\(path("tpm/swtpm.log"))",
        ], timeout: 15)

        var args = [
            "-name", id, "-L", Bundled.qemuData.path,
            "-machine", "virt,highmem=on",
            "-accel", "hvf", "-cpu", "host",
            "-smp", "\(vm.cpus)", "-m", "\(vm.memoryGB)G",
            "-drive", "if=pflash,format=raw,readonly=on,file=\(code.path)",
            "-drive", "if=pflash,format=raw,file=\(path("vars.fd"))",
            "-chardev", "socket,id=chrtpm,path=\(path("tpm/swtpm.sock"))",
            // ppi=off: the 1 KiB Physical Presence RAM region is smaller than the 16 KiB host page, which HVF rejects.
            "-tpmdev", "emulator,id=tpm0,chardev=chrtpm", "-device", "tpm-tis-device,tpmdev=tpm0,ppi=off",
            // ramfb: linear framebuffer Windows' Basic Display driver can use with no VirtIO driver (setup).
            // virtio-gpu: resizable display for after viogpudo is installed; EDK2's VirtIO GOP is Blt-only,
            // so Windows shows nothing on it until that driver loads.
            "-device", vm.display == "virtio-gpu" ? "virtio-gpu-pci" : "ramfb",
            "-device", "qemu-xhci,id=xhci", "-device", "usb-kbd", "-device", "usb-tablet",
            // NVMe uses Windows' inbox driver, so setup sees the disk without loading VirtIO storage drivers.
            "-drive", "if=none,id=disk0,format=qcow2,discard=unmap,file=\(path("disk.qcow2"))",
            "-device", "nvme,drive=disk0,serial=containerscope0,bootindex=1",
            "-rtc", "base=localtime",
            "-monitor", "unix:\(path("monitor.sock")),server=on,wait=off",
            "-pidfile", path("qemu.pid"),
            // zoom-to-fit: the window can be resized at any time; the guest image scales to it.
            "-display", "cocoa,zoom-to-fit=on",
        ]
        for (index, iso) in isos.enumerated() {
            args += ["-drive", "if=none,id=cd\(index),media=cdrom,readonly=on,file=\(iso)",
                     "-device", "usb-storage,drive=cd\(index),removable=on" + (index == 0 ? ",bootindex=0" : "")]
        }
        args += Self.networkArgs(vm)
        try isos.joined(separator: "\n").write(toFile: path("media.txt"), atomically: true, encoding: .utf8)

        let process = Process()
        process.executableURL = qemu
        process.arguments = args
        process.standardInput = FileHandle.nullDevice
        fm.createFile(atPath: path("qemu.log"), contents: nil)
        let log = try FileHandle(forWritingTo: URL(fileURLWithPath: path("qemu.log")))
        process.standardOutput = log
        process.standardError = log
        try process.run()

        // QEMU writes its pidfile once the machine is realized; an early exit means a bad configuration.
        for _ in 0..<50 {
            try await Task.sleep(for: .milliseconds(100))
            if !process.isRunning {
                killTPM(dir)
                let detail = (try? String(contentsOfFile: path("qemu.log"), encoding: .utf8))?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                throw CLIError(message: detail.isEmpty ? "QEMU exited with status \(process.terminationStatus)" : detail)
            }
            if fm.fileExists(atPath: path("qemu.pid")) { break }
        }
        return "\(process.processIdentifier)"
    }

    func setDisplay(id: String, display: String) throws {
        guard ["ramfb", "virtio-gpu"].contains(display) else { throw CLIError(message: "Unknown display \(display)") }
        let vm = try vm(id)
        guard !vm.running else { throw CLIError(message: "Shut down \(id) before changing its display") }
        let file = vm.dir.appendingPathComponent("vm.json")
        var config = (try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]) ?? [:]
        config["display"] = display
        try JSONSerialization.data(withJSONObject: config).write(to: file, options: .atomic)
    }

    func setNetwork(id: String, network: Network) throws {
        let vm = try vm(id)
        guard !vm.running else { throw CLIError(message: "Shut down \(id) before changing its network") }
        try checkForwardConflicts(network, id: id)
        let file = vm.dir.appendingPathComponent("vm.json")
        var config = (try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]) ?? [:]
        config["network"] = network.json
        if !Self.validMAC(config["mac"] as? String ?? "") { config["mac"] = vm.mac }
        try JSONSerialization.data(withJSONObject: config).write(to: file, options: .atomic)
    }

    /// QEMU user networking (slirp: outbound NAT, guest at 10.0.2.15) on a virtio-net-pci adapter with
    /// the VM's own MAC. Forwards listen on 127.0.0.1 only, so the guest isn't exposed to the LAN.
    static func networkArgs(_ vm: VM) -> [String] {
        guard vm.network.mode != "none" else { return ["-nic", "none"] }
        let forwards = vm.network.forwards.map { ",hostfwd=tcp:127.0.0.1:\($0.host)-:\($0.guest)" }.joined()
        return ["-netdev", "user,id=net0" + forwards, "-device", "virtio-net-pci,netdev=net0,mac=\(vm.mac)"]
    }

    private func killTPM(_ dir: URL) {
        guard let text = try? String(contentsOf: dir.appendingPathComponent("tpm/swtpm.pid"), encoding: .utf8),
              let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return }
        kill(pid, SIGTERM)
    }

    /// ACPI power button (Windows shuts down cleanly), or immediate power-off when `force`.
    func stop(id: String, force: Bool) throws {
        let vm = try vm(id)
        guard let pid = vm.pid else { return }
        if force {
            kill(pid, SIGTERM)
            return
        }
        try Self.monitor(vm.dir.appendingPathComponent("monitor.sock").path, "system_powerdown")
    }

    func delete(id: String) throws {
        let vm = try vm(id)
        guard !vm.running else { throw CLIError(message: "Shut down \(id) before deleting it") }
        try FileManager.default.removeItem(at: vm.dir)
    }

    func logTail(id: String) throws -> String {
        let text = (try? String(contentsOf: try vm(id).dir.appendingPathComponent("qemu.log"), encoding: .utf8)) ?? ""
        return String(text.suffix(4000))
    }

    /// Mirrors (fedorapeople.org) redirect https → http; App Transport Security blocks that, so
    /// follow redirects over https instead of weakening ATS for the whole app.
    private final class SecureRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            guard let url = request.url, url.scheme == "http", var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                completionHandler(request)
                return
            }
            parts.scheme = "https"
            var upgraded = request
            upgraded.url = parts.url
            completionHandler(upgraded)
        }
    }

    private static let session = URLSession(configuration: .default, delegate: SecureRedirects(), delegateQueue: nil)

    // MARK: Helpers

    nonisolated static func safeFileName(_ name: String) -> Bool {
        guard let first = name.unicodeScalars.first, CharacterSet.alphanumerics.contains(first), name.utf8.count <= 200 else { return false }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-+"))
        return name.unicodeScalars.allSatisfy(allowed.contains)
    }

    /// Sends one human-monitor command over the VM's UNIX socket.
    private static func monitor(_ socketPath: String, _ command: String) throws {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw CLIError(message: "Could not open monitor socket") }
        defer { close(fd) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(socketPath.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else { throw CLIError(message: "Monitor socket path too long") }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            buffer.copyBytes(from: bytes)
            buffer[bytes.count] = 0
        }
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard connected == 0 else { throw CLIError(message: "The VM monitor is not reachable") }
        let line = Array("\(command)\n".utf8)
        guard write(fd, line, line.count) == line.count else { throw CLIError(message: "Could not send \(command)") }
        usleep(200_000)   // let QEMU read before the socket closes
    }
}
