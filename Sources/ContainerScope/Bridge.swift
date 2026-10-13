import AppKit
import WebKit

/// JS → Swift RPC. The page calls `webkit.messageHandlers.bridge.postMessage({method, params})`
/// and receives a string (CLI stdout) or a rejected promise with the error text.
/// Only allow-listed methods exist; every identifier is validated before it reaches argv,
/// and destructive actions are confirmed natively so the web layer cannot bypass the prompt.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?
    private weak var model: AppModel?
    private let cli: ContainerCLI

    init(cli: ContainerCLI, model: AppModel) {
        self.cli = cli
        self.model = model
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "Malformed bridge message")
            return
        }
        let params = Params(body["params"] as? [String: Any] ?? [:])
        Task {
            do {
                replyHandler(try await handle(method, params), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private func handle(_ method: String, _ p: Params) async throws -> String {
        switch method {
        case "route":
            guard let name = p.string("name"), let route = Route(rawValue: name) else {
                throw CLIError(message: "Unknown route")
            }
            model?.routeFromWeb(route)
            return ""
        case "currentRoute": return model?.route.rawValue ?? Route.overview.rawValue
        case "status": return try await cli.run(["system", "status", "--format", "json"], timeout: 10)
        case "df": return try await cli.run(["system", "df", "--format", "json"])
        case "containers": return try await cli.run(["list", "--all", "--format", "json"])
        case "stats": return try await cli.run(["stats", "--no-stream", "--format", "json"])
        case "images": return try await cli.run(["image", "list", "--format", "json"])
        case "volumes": return try await cli.run(["volume", "list", "--format", "json"])
        case "networks": return try await cli.run(["network", "list", "--format", "json"])

        case "inspect":
            return try await cli.run(["inspect", try p.id()])
        case "logs":
            let lines = min(max(p.int("lines") ?? 500, 1), 10_000)
            var args = ["logs", "-n", String(lines)]
            if p.bool("boot") { args.append("--boot") }
            return try await cli.run(args + [try p.id()])
        case "top":
            let id = try p.id()
            do {
                return try await cli.run(["exec", "--", id, "ps", "-o", "pid,user,time,vsz,rss,args"], timeout: 10)
            } catch {
                return try await cli.run(["exec", "--", id, "ps"], timeout: 10)
            }
        case "exec":
            let id = try p.id()
            let argv = try p.argv()
            return try await cli.run(["exec", "--", id] + argv, timeout: 60)
        case "openShell":
            try openShell(id: try p.id())
            return ""

        case "start": return try await cli.run(["start", try p.id()], timeout: 120)
        case "stop": return try await cli.run(["stop", try p.id()], timeout: 60)
        case "kill":
            let id = try p.id()
            try await confirm("Kill “\(id)”?", "The container's processes receive SIGKILL immediately and cannot clean up.", action: "Kill")
            return try await cli.run(["kill", id])
        case "delete":
            let id = try p.id()
            let force = p.bool("force")
            try await confirm(
                "Delete “\(id)”?",
                force ? "The container is running. It will be stopped and its filesystem removed." : "The container and its filesystem will be removed.",
                action: "Delete"
            )
            return try await cli.run(["delete"] + (force ? ["--force"] : []) + [id], timeout: 60)

        case "imagePull":
            return try await cli.run(["image", "pull", "--progress", "plain", try p.reference()], timeout: 1800)
        case "imageDelete":
            let ref = try p.reference()
            try await confirm("Delete image “\(ref)”?", "Layers not shared with other images are removed from disk.", action: "Delete")
            return try await cli.run(["image", "delete", ref], timeout: 120)
        case "imagePrune":
            try await confirm("Remove dangling images?", "Untagged images that no container uses are deleted.", action: "Prune")
            return try await cli.run(["image", "prune"], timeout: 300)

        // MARK: Engine
        case "version": return try await cli.run(["system", "version", "--format", "json"], timeout: 10)
        case "latestRelease": return try await ReleaseCheck.latest()
        case "hostInfo": return HostInfo.json()
        case "routeInterface": return await NetworkHealth.defaultRouteInterface() ?? ""
        case "networkDiagnose": return try await NetworkHealth.diagnose(network: try p.id(), cli: cli)
        case "properties": return try await cli.run(["system", "property", "list", "--format", "json"])
        case "openURL":
            guard let string = p.string("url"), let url = URL(string: string), url.scheme == "https" else { throw CLIError(message: "Only https links open externally") }
            NSWorkspace.shared.open(url)
            return ""
        case "installRosetta":
            try await HostInfo.installRosetta()
            return ""
        case "servicesStart":
            defer { model?.refreshAfterServiceChange() }
            return try await cli.run(["system", "start", "--disable-kernel-install"], timeout: 120)
        case "servicesStop":
            try await confirm("Stop container services?", "Every running container, machine, and Kubernetes node stops.", action: "Stop")
            defer { model?.refreshAfterServiceChange() }
            return try await cli.run(["system", "stop"], timeout: 120)
        case "servicesRestart":
            try await confirm("Restart container services?", "Every running container, machine, and Kubernetes node stops; services start again.", action: "Restart")
            defer { model?.refreshAfterServiceChange() }
            _ = try await cli.run(["system", "stop"], timeout: 120)
            return try await cli.run(["system", "start", "--disable-kernel-install"], timeout: 120)
        case "engineUpgrade":
            guard let brew = ContainerCLI.homebrew else { throw CLIError(message: "Homebrew not found. Upgrade with the signed installer from github.com/apple/container/releases.") }
            try await confirm("Upgrade the container engine?", "Services stop, Homebrew upgrades the `container` formula, then services start again. Running containers stop.", action: "Upgrade")
            defer { model?.refreshAfterServiceChange() }
            _ = try await cli.run(["system", "stop"], timeout: 120)
            let output: String
            do {
                _ = try await ContainerCLI.run(brew, ["update"], timeout: 600)
                output = try await ContainerCLI.run(brew, ["upgrade", "container"], timeout: 1800)
            } catch {
                _ = try? await cli.run(["system", "start", "--disable-kernel-install"], timeout: 120)
                throw error
            }
            _ = try await cli.run(["system", "start", "--disable-kernel-install"], timeout: 120)
            return output
        case "kernelChoose":
            return try await chooseFile(title: "Choose a Linux kernel (vmlinux / Image)")
        case "kernelSetDefault":
            let path = try p.existingFile("path")
            try await confirm("Use this kernel for new containers?", path, action: "Set Default")
            return try await cli.run(["system", "kernel", "set", "--binary", path, "--force"], timeout: 120)
        case "kernelRecommended":
            try await confirm("Install the recommended kernel?", "Downloads Apple's recommended kernel and makes it the default for new containers.", action: "Install")
            return try await cli.run(["system", "kernel", "set", "--recommended", "--force"], timeout: 600)

        // MARK: Machines
        case "machines": return try await cli.run(["machine", "list", "--format", "json"])
        case "machineInspect": return try await cli.run(["machine", "inspect", try p.id()])
        case "machineCreate":
            var args = ["machine", "create", "--progress", "plain", "--name", try p.id()]
            if let cpus = p.int("cpus") { args += ["--cpus", String(min(max(cpus, 1), 64))] }
            if let memory = try p.memory("memory") { args += ["--memory", memory] }
            if let mount = p.string("homeMount") {
                guard ["rw", "ro", "none"].contains(mount) else { throw CLIError(message: "Invalid home mount") }
                args += ["--home-mount", mount]
            }
            if p.bool("virtualization") { args.append("--virtualization") }
            if p.string("kernel")?.isEmpty == false { args += ["--kernel", try p.existingFile("kernel")] }
            return try await cli.run(args + [try p.reference()], timeout: 1800)
        case "machineBoot": return try await cli.run(["machine", "run", "--name", try p.id(), "true"], timeout: 300)
        case "machineStop": return try await cli.run(["machine", "stop", try p.id()], timeout: 120)
        case "machineDelete":
            let id = try p.id()
            try await confirm("Delete machine “\(id)”?", "Its disk and configuration are removed.", action: "Delete")
            return try await cli.run(["machine", "delete", id], timeout: 120)
        case "machineSetDefault": return try await cli.run(["machine", "set-default", try p.id()])
        case "machineSet":
            let id = try p.id()
            let key = p.string("key") ?? ""
            let value: String
            switch key {
            case "cpus": value = String(min(max(p.int("value") ?? 0, 1), 64))
            case "memory": guard let m = try p.memory("value") else { throw CLIError(message: "Memory required") }; value = m
            case "virtualization": value = p.bool("value") ? "true" : "false"
            case "home-mount":
                value = p.string("value") ?? ""
                guard ["rw", "ro", "none"].contains(value) else { throw CLIError(message: "Invalid home mount") }
            case "kernel": value = p.string("value")?.isEmpty == false ? try p.existingFile("value") : ""
            default: throw CLIError(message: "Unsupported machine setting")
            }
            return try await cli.run(["machine", "set", "--name", id, "\(key)=\(value)"])
        case "machineProbe":
            // Nested virtualization needs both EL2 from the host hypervisor and a guest kernel with KVM.
            let id = try p.id()
            async let kernel = cli.run(["machine", "run", "--name", id, "--root", "uname", "-r"], timeout: 120)
            async let kvm = try? cli.run(["machine", "run", "--name", id, "--root", "ls", "-l", "/dev/kvm"], timeout: 120)
            async let dmesg = try? cli.run(["machine", "run", "--name", id, "--root", "dmesg"], timeout: 120)
            let log = await dmesg ?? ""
            let result: [String: Any] = [
                "kernel": try await kernel.trimmingCharacters(in: .whitespacesAndNewlines),
                "el2": log.contains("started at EL2"),
                "kvmDevice": await kvm.map { $0.contains("/dev/kvm") } ?? false,
                "kvmLog": log.split(separator: "\n").filter { $0.localizedCaseInsensitiveContains("kvm") }.prefix(6).joined(separator: "\n"),
            ]
            return String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
        case "machineShell":
            let id = try p.id()
            try openTerminal(title: "machine \(id)", arguments: ["machine", "run", "-i", "-t", "--name", id])
            return ""

        // MARK: Kubernetes
        case "k8sList": return try await cli.run(["k8s", "list"])
        case "k8sCreate":
            var args = ["k8s", "create", "--name", try p.id()]
            if let cpus = p.int("cpus") { args += ["--cpus", String(min(max(cpus, 1), 64))] }
            if let memory = try p.memory("memory") { args += ["--memory", memory] }
            return try await cli.run(args, timeout: 1800)
        case "k8sDelete":
            let name = try p.id()
            try await confirm("Delete cluster “\(name)”?", "Its node containers and workloads are removed.", action: "Delete")
            return try await cli.run(["k8s", "delete", "--name", name], timeout: 300)
        case "k8sWriteConfig":
            return try await cli.run(["k8s", "write-config", "--name", try p.id()], timeout: 60)
        case "k8sLoadImage":
            return try await cli.run(["k8s", "load-image", "--name", try p.id(), try p.reference()], timeout: 900)
        case "k8sGet":
            // kind node images ship kubectl and an admin kubeconfig, so no host kubectl is required.
            let kind = p.string("kind") ?? ""
            guard ["nodes", "pods", "services", "deployments"].contains(kind) else { throw CLIError(message: "Unsupported resource") }
            return try await cli.run(["exec", "-e", "KUBECONFIG=/etc/kubernetes/admin.conf", "--", try p.id(), "kubectl", "get", kind, "-A", "-o", "json"], timeout: 30)

        // MARK: Windows on ARM (QEMU + HVF)
        case "winStatus": return try WindowsVMs.shared.statusJSON()
        case "winInstallTools":
            guard let brew = ContainerCLI.homebrew else { throw CLIError(message: "Homebrew not found. Install it from brew.sh, then retry.") }
            try await confirm("Install QEMU and swtpm?", "Homebrew installs qemu (with Hypervisor.framework acceleration and UEFI firmware) and swtpm (TPM 2.0 for Windows 11).", action: "Install")
            return try await ContainerCLI.run(brew, ["install", "qemu", "swtpm"], timeout: 1800)
        case "isoDownload":
            guard let text = p.string("url")?.trimmingCharacters(in: .whitespacesAndNewlines), let url = URL(string: text) else {
                throw CLIError(message: "Paste a download link")
            }
            return try WindowsVMs.shared.download(url)
        case "isoDownloadVirtio": return try WindowsVMs.shared.download(WindowsVMs.virtioURL)
        case "winSecureBootFirmware":
            return try await WindowsVMs.shared.installSecureBootFirmware(cli: cli)
        case "winCatalog": return try await MicrosoftISO.shared.catalog()
        case "isoDownloadWindows":
            guard let edition = p.string("edition"), edition.allSatisfy(\.isNumber),
                  let language = p.string("language"), !language.isEmpty, language.count <= 80 else {
                throw CLIError(message: "Choose a version and language")
            }
            return try WindowsVMs.shared.download(try await MicrosoftISO.shared.link(edition: edition, language: language))
        case "isoCancel":
            WindowsVMs.shared.cancelDownload(try p.fileName())
            return ""
        case "isoDelete":
            let name = try p.fileName()
            try await confirm("Delete \(name)?", "The installer image is removed from the temporary download folder.", action: "Delete")
            return String(try WindowsVMs.shared.cleanMedia(only: name))
        case "isoCleanup":
            try await confirm("Clean up installer downloads?", "Every ISO in the temporary download folder is deleted, except media attached to a running VM.", action: "Clean Up")
            return String(try WindowsVMs.shared.cleanMedia(only: nil))
        case "isoChoose":
            let path = try await chooseFile(title: "Choose a Windows ARM64 or driver ISO")
            guard path.lowercased().hasSuffix(".iso") else { throw CLIError(message: "Choose an .iso file") }
            return path
        case "winCreate":
            let cpus = min(max(p.int("cpus") ?? 4, 2), 64)
            let memory = min(max(p.int("memoryGB") ?? 8, 4), 256)
            let disk = min(max(p.int("diskGB") ?? 64, 64), 2048)
            return try await WindowsVMs.shared.create(id: try p.id(), cpus: cpus, memoryGB: memory, diskGB: disk)
        case "winStart":
            let isos = try (p.stringArray("isos") ?? []).prefix(4).map { try Params.isoPath($0) }
            return try await WindowsVMs.shared.start(id: try p.id(), isos: Array(isos))
        case "winShutdown":
            try WindowsVMs.shared.stop(id: try p.id(), force: false)
            return ""
        case "winPowerOff":
            let id = try p.id()
            try await confirm("Power off \(id)?", "Like pulling the plug: unsaved work in Windows is lost. Use Shut Down for a clean stop.", action: "Power Off")
            try WindowsVMs.shared.stop(id: id, force: true)
            return ""
        case "winSetDisplay":
            try WindowsVMs.shared.setDisplay(id: try p.id(), display: p.string("display") ?? "")
            return ""
        case "winDelete":
            let id = try p.id()
            try await confirm("Delete \(id)?", "Its virtual disk, UEFI variables and TPM state are removed permanently.", action: "Delete")
            try WindowsVMs.shared.delete(id: id)
            return ""
        case "winLog": return try WindowsVMs.shared.logTail(id: try p.id())

        default:
            throw CLIError(message: "Unknown bridge method “\(method)”")
        }
    }

    private func chooseFile(title: String) async throws -> String {
        guard let window = webView?.window else { throw CLIError(message: "No window") }
        let panel = NSOpenPanel()
        panel.message = title
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { throw CLIError(message: "Cancelled") }
        return url.path
    }

    private func confirm(_ title: String, _ detail: String, action: String) async throws {
        guard let window = webView?.window else { throw CLIError(message: "No window for confirmation") }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = detail
        let destructive = alert.addButton(withTitle: action)
        destructive.hasDestructiveAction = true
        alert.addButton(withTitle: "Cancel")
        let response = await alert.beginSheetModal(for: window)
        guard response == .alertFirstButtonReturn else { throw CLIError(message: "Cancelled") }
    }

    /// Interactive shells need a real TTY: hand off to Terminal via a temporary `.command` script.
    private func openShell(id: String) throws {
        try openTerminal(title: id, arguments: ["exec", "-it", "--", id, "sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"])
    }

    private func openTerminal(title: String, arguments: [String]) throws {
        guard let executable = cli.executable else { throw CLIError(message: "container CLI not found") }
        let quote = { (s: String) in "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let script = """
        #!/bin/sh
        clear
        echo \(quote("ContainerScope → \(title)"))
        exec \(([executable.path] + arguments).map(quote).joined(separator: " "))

        """
        let safeName = title.replacingOccurrences(of: " ", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("containerscope-\(safeName).command")
        try script.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        guard NSWorkspace.shared.open(url) else { throw CLIError(message: "Could not open Terminal") }
    }
}

/// Typed, validated access to bridge params. Identifiers may not start with `-`,
/// which keeps them from being parsed as CLI flags.
private struct Params {
    private let raw: [String: Any]
    init(_ raw: [String: Any]) { self.raw = raw }

    /// ASCII alphanumeric first character, then only `allowed` characters; nothing shell- or flag-like.
    private static func token(_ value: String?, extra: String, maxLength: Int) -> String? {
        guard let value, let first = value.unicodeScalars.first, value.utf8.count <= maxLength else { return nil }
        let alnum = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        let allowed = alnum.union(CharacterSet(charactersIn: extra))
        guard alnum.contains(first), value.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return value
    }

    func id() throws -> String {
        guard let value = Self.token(raw["id"] as? String, extra: "_.-", maxLength: 128) else {
            throw CLIError(message: "Invalid container id")
        }
        return value
    }

    func reference() throws -> String {
        let trimmed = (raw["ref"] as? String)?.trimmingCharacters(in: .whitespaces)
        guard let value = Self.token(trimmed, extra: "_.-/:@", maxLength: 256) else {
            throw CLIError(message: "Invalid image reference")
        }
        return value
    }

    func argv() throws -> [String] {
        guard let values = raw["argv"] as? [String], !values.isEmpty, values.count <= 64,
              values.allSatisfy({ $0.utf8.count <= 4096 }) else {
            throw CLIError(message: "Command must be 1–64 arguments")
        }
        return values
    }

    /// Sizes like `512M`, `4G`; nil when absent or empty.
    func memory(_ key: String) throws -> String? {
        guard let value = (raw[key] as? String)?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
        guard let unit = value.last, "KMGT".contains(unit.uppercased()), let number = Int(value.dropLast()), (1...1_048_576).contains(number) else {
            throw CLIError(message: "Memory must look like 512M or 4G")
        }
        return "\(number)\(unit.uppercased())"
    }

    /// Absolute path to an existing regular file (kernels chosen via the open panel).
    func existingFile(_ key: String) throws -> String {
        var isDirectory: ObjCBool = false
        guard let path = raw[key] as? String, path.hasPrefix("/"),
              FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            throw CLIError(message: "Kernel file not found")
        }
        return path
    }

    /// File name inside the temp media folder (download progress / cleanup).
    func fileName() throws -> String {
        guard let name = raw["name"] as? String, WindowsVMs.safeFileName(name) else { throw CLIError(message: "Invalid file name") }
        return name
    }

    /// Absolute path to an existing `.iso` file.
    static func isoPath(_ path: String) throws -> String {
        var isDirectory: ObjCBool = false
        guard path.hasPrefix("/"), path.lowercased().hasSuffix(".iso"), !path.contains(","),
              FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            throw CLIError(message: "ISO not found: \(path)")
        }
        return path
    }

    func stringArray(_ key: String) -> [String]? { raw[key] as? [String] }

    func int(_ key: String) -> Int? { (raw[key] as? NSNumber)?.intValue }
    func string(_ key: String) -> String? { raw[key] as? String }
    func bool(_ key: String) -> Bool { (raw[key] as? NSNumber)?.boolValue ?? false }
}
