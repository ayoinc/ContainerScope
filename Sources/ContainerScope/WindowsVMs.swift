import Foundation

/// Windows on ARM guests run on QEMU with Apple's Hypervisor.framework (`-accel hvf`), UEFI from
/// QEMU's EDK2 build, and a software TPM 2.0 (swtpm) for Windows 11. Install media is downloaded
/// into a temporary folder that the user cleans up once setup has finished.
@MainActor
final class WindowsVMs {
    static let shared = WindowsVMs()

    /// Fedora's stable VirtIO driver ISO (network, balloon, serial for Windows guests).
    static let virtioURL = URL(string: "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso")!

    let vmRoot: URL
    let mediaDir: URL
    /// Secure Boot UEFI with Microsoft keys enrolled (Ubuntu's AAVMF build); Homebrew's aarch64 EDK2 has no Secure Boot.
    let firmwareDir: URL
    private var secureBootCode: URL { firmwareDir.appendingPathComponent("AAVMF_CODE.ms.fd") }
    private var secureBootVars: URL { firmwareDir.appendingPathComponent("AAVMF_VARS.ms.fd") }
    var hasSecureBootFirmware: Bool {
        FileManager.default.fileExists(atPath: secureBootCode.path) && FileManager.default.fileExists(atPath: secureBootVars.path)
    }
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

    private static func tool(_ name: String) -> URL? {
        ["/opt/homebrew/bin/\(name)", "/usr/local/bin/\(name)"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
            .map(URL.init(fileURLWithPath:))
    }

    private static func firmware(_ name: String) -> URL? {
        guard let qemu = tool("qemu-system-aarch64") else { return nil }
        // <prefix>/bin/qemu-system-aarch64 → <prefix>/share/qemu/<name>
        let url = qemu.resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("share/qemu/\(name)")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
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
            "qemu": Self.tool("qemu-system-aarch64")?.path ?? "",
            "swtpm": Self.tool("swtpm")?.path ?? "",
            "firmware": Self.firmware("edk2-aarch64-code.fd")?.path ?? "",
            "secureBoot": hasSecureBootFirmware,
            "homebrew": ContainerCLI.homebrew != nil,
            "mediaDir": mediaDir.path,
            "vmRoot": vmRoot.path,
            "media": mediaItems.sorted { ($0["name"] as! String) < ($1["name"] as! String) },
            "vms": try vms().map(\.json),
            "virtioURL": Self.virtioURL.absoluteString,
        ]
        return String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
    }

    // MARK: Install media

    /// Starts a background download into the temp media folder; progress is reported by `statusJSON`.
    func download(_ source: URL) throws -> String {
        guard source.scheme == "https" else { throw CLIError(message: "Only https:// download links are allowed") }
        let name = source.lastPathComponent
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
        var isos: [String] = []
        var pid: Int32?

        var running: Bool { pid != nil }

        var json: [String: Any] {
            let disk = dir.appendingPathComponent("disk.qcow2")
            let used = (try? disk.resourceValues(forKeys: [.totalFileAllocatedSizeKey]).totalFileAllocatedSize) ?? 0
            return ["id": id, "cpus": cpus, "memoryGB": memoryGB, "diskGB": diskGB, "diskUsed": used,
                    "running": running, "isos": isos, "dir": dir.path]
        }
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

    func create(id: String, cpus: Int, memoryGB: Int, diskGB: Int) async throws -> String {
        guard let qemuImg = Self.tool("qemu-img") else { throw CLIError(message: "QEMU is not installed. Use Install QEMU first.") }
        guard hasSecureBootFirmware else { throw CLIError(message: "Windows 11 needs Secure Boot. Use Get Secure Boot Firmware first.") }
        let vars = secureBootVars
        // UNIX socket paths are limited to 104 bytes, so keep names short.
        guard id.utf8.count <= 24 else { throw CLIError(message: "Use a name of 24 characters or fewer") }
        let dir = vmRoot.appendingPathComponent(id, isDirectory: true)
        let fm = FileManager.default
        guard !fm.fileExists(atPath: dir.path) else { throw CLIError(message: "\(id) already exists") }
        try fm.createDirectory(at: dir.appendingPathComponent("tpm"), withIntermediateDirectories: true)
        do {
            // Per-VM copy of the UEFI variable store (Microsoft keys enrolled) so boot entries and Secure Boot state persist.
            try fm.copyItem(at: vars, to: dir.appendingPathComponent("vars.fd"))
            _ = try await ContainerCLI.run(qemuImg, ["create", "-f", "qcow2", dir.appendingPathComponent("disk.qcow2").path, "\(diskGB)G"], timeout: 60)
            let config: [String: Any] = ["cpus": cpus, "memoryGB": memoryGB, "diskGB": diskGB, "created": ISO8601DateFormatter().string(from: Date())]
            try JSONSerialization.data(withJSONObject: config).write(to: dir.appendingPathComponent("vm.json"))
        } catch {
            try? fm.removeItem(at: dir)
            throw error
        }
        return id
    }

    func start(id: String, isos: [String]) async throws -> String {
        guard let qemu = Self.tool("qemu-system-aarch64"), let swtpm = Self.tool("swtpm") else {
            throw CLIError(message: "QEMU and swtpm are required. Use Install QEMU first.")
        }
        guard hasSecureBootFirmware else { throw CLIError(message: "Secure Boot firmware is missing. Use Get Secure Boot Firmware.") }
        let code = secureBootCode
        let vm = try vm(id)
        guard !vm.running else { throw CLIError(message: "\(id) is already running") }
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
            "-name", id,
            "-machine", "virt,highmem=on",
            "-accel", "hvf", "-cpu", "host",
            "-smp", "\(vm.cpus)", "-m", "\(vm.memoryGB)G",
            "-drive", "if=pflash,format=raw,readonly=on,file=\(code.path)",
            "-drive", "if=pflash,format=raw,file=\(path("vars.fd"))",
            "-chardev", "socket,id=chrtpm,path=\(path("tpm/swtpm.sock"))",
            // ppi=off: the 1 KiB Physical Presence RAM region is smaller than the 16 KiB host page, which HVF rejects.
            "-tpmdev", "emulator,id=tpm0,chardev=chrtpm", "-device", "tpm-tis-device,tpmdev=tpm0,ppi=off",
            // ramfb is the display Windows on ARM drives without extra drivers; USB HID keeps input working pre-driver.
            "-device", "ramfb",
            "-device", "qemu-xhci,id=xhci", "-device", "usb-kbd", "-device", "usb-tablet",
            // NVMe uses Windows' inbox driver, so setup sees the disk without loading VirtIO storage drivers.
            "-drive", "if=none,id=disk0,format=qcow2,discard=unmap,file=\(path("disk.qcow2"))",
            "-device", "nvme,drive=disk0,serial=containerscope0,bootindex=1",
            // Network needs the VirtIO driver from virtio-win.iso; until then setup runs offline (OOBE\BYPASSNRO).
            "-nic", "user,model=virtio-net-pci",
            "-rtc", "base=localtime",
            "-monitor", "unix:\(path("monitor.sock")),server=on,wait=off",
            "-pidfile", path("qemu.pid"),
            "-display", "cocoa",
        ]
        for (index, iso) in isos.enumerated() {
            args += ["-drive", "if=none,id=cd\(index),media=cdrom,readonly=on,file=\(iso)",
                     "-device", "usb-storage,drive=cd\(index),removable=on" + (index == 0 ? ",bootindex=0" : "")]
        }
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

    /// Builds Ubuntu's Secure Boot `qemu-efi-aarch64` from source with the ContainerScope boot logo,
    /// inside the container engine itself (Firmware/build-aavmf.sh, bundled in Resources/Firmware).
    func installSecureBootFirmware(cli: ContainerCLI) async throws -> String {
        guard let recipe = Bundle.main.resourceURL?.appendingPathComponent("Firmware"),
              FileManager.default.fileExists(atPath: recipe.appendingPathComponent("build-aavmf.sh").path) else {
            throw CLIError(message: "Firmware recipe missing from the app bundle. Rebuild with Scripts/build-app.sh.")
        }
        try FileManager.default.createDirectory(at: firmwareDir, withIntermediateDirectories: true)
        return try await cli.run([
            "run", "--rm", "-c", "8", "-m", "8G",
            "-v", "\(recipe.path):/in:ro", "-v", "\(firmwareDir.path):/out",
            "docker.io/library/ubuntu:24.04", "sh", "/in/build-aavmf.sh",
        ], timeout: 1800)
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
