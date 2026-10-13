import Foundation

struct CLIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Runs the Apple `container` CLI with an argv array (never through a shell).
///
/// Engine choice: an engine the user installed (CONTAINER_BIN, Homebrew, Apple's installer, PATH)
/// wins, because only one engine can run at a time (they share launchd labels and data). Otherwise
/// the engine bundled in the app runs in place from Contents/Resources/Engine.
struct ContainerCLI: Sendable {
    enum Source: String, Sendable { case custom, homebrew, installer, path, bundled }

    let executable: URL?
    let source: Source?

    init() {
        (executable, source) = Self.locate()
    }

    /// GUI apps inherit a minimal PATH, so probe the known install locations explicitly.
    private static func locate() -> (URL?, Source?) {
        let fm = FileManager.default
        var candidates: [(String, Source)] = []
        if let override = ProcessInfo.processInfo.environment["CONTAINER_BIN"] { candidates.append((override, .custom)) }
        candidates += [("/opt/homebrew/bin/container", .homebrew), ("/usr/local/bin/container", .installer)]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { ("\($0)/container", .path) }
        }
        if let found = candidates.first(where: { fm.isExecutableFile(atPath: $0.0) }) {
            let url = URL(fileURLWithPath: found.0)
            // Homebrew can live under /usr/local too; the resolved path says which installer owns it.
            let source: Source = url.resolvingSymlinksInPath().path.contains("/Cellar/") ? .homebrew : found.1
            return (url, source)
        }
        if let bundled = Bundled.engineCLI { return (bundled, .bundled) }
        return (nil, nil)
    }

    var isBundled: Bool { source == .bundled }

    func run(_ arguments: [String], timeout: TimeInterval = 30) async throws -> String {
        guard let executable else {
            throw CLIError(message: "The container engine is missing from the app bundle. Reinstall ContainerScope, or set CONTAINER_BIN to an installed `container` CLI.")
        }
        return try await Self.run(executable, arguments, timeout: timeout)
    }

    /// `container system start`. The bundled engine registers its launchd services from inside the
    /// app bundle (so starting again after the app moves re-points them), and gets the bundled
    /// kernel instead of the engine's 700 MB first-run download. It refuses to start from the disk
    /// image or a translocated copy, whose paths vanish once the image is ejected.
    func startServices() async throws -> String {
        guard isBundled else { return try await run(["system", "start", "--disable-kernel-install"], timeout: 120) }
        let appPath = Bundle.main.bundlePath
        guard !appPath.contains("/AppTranslocation/"), !appPath.hasPrefix("/Volumes/") else {
            throw CLIError(message: "Move ContainerScope to your Applications folder and open it from there. The engine runs from inside the app, so it can't start from the disk image.")
        }
        let output = try await run(["system", "start", "--install-root", Bundled.engineRoot.path, "--disable-kernel-install"], timeout: 120)
        if let kernel = Bundled.kernel, !(try await hasDefaultKernel()) {
            _ = try await run(["system", "kernel", "set", "--binary", kernel.path, "--force"], timeout: 120)
        }
        return output
    }

    /// The engine keeps its default kernel as kernels/default.kernel-<arch> under its data root.
    private func hasDefaultKernel() async throws -> Bool {
        let json = try await run(["system", "status", "--format", "json"], timeout: 10)
        guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let appRoot = (object["paths"] as? [String: Any])?["appRoot"] as? String else { return false }
        let link = URL(fileURLWithPath: appRoot).appendingPathComponent("kernels/default.kernel-arm64")
        return FileManager.default.fileExists(atPath: link.path)
    }

    /// Runs any executable by absolute path (Homebrew for engine upgrades), with the same capture rules.
    static func run(_ executable: URL, _ arguments: [String], timeout: TimeInterval = 30) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result { try runBlocking(executable, arguments, timeout) })
            }
        }
    }

    static let homebrew: URL? = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
        .first { FileManager.default.isExecutableFile(atPath: $0) }
        .map(URL.init(fileURLWithPath:))

    private final class Box: @unchecked Sendable {
        var data = Data()
        var timedOut = false
    }

    private static func runBlocking(_ executable: URL, _ arguments: [String], _ timeout: TimeInterval) throws -> String {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
        } catch {
            throw CLIError(message: "Failed to launch container CLI: \(error.localizedDescription)")
        }

        let errBox = Box()
        let state = Box()
        let watchdog = DispatchWorkItem {
            if process.isRunning {
                state.timedOut = true
                process.terminate()
            }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: watchdog)

        // Drain both pipes concurrently so a full stderr buffer cannot block stdout.
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            errBox.data = stderr.fileHandleForReading.readDataToEndOfFile()
            group.leave()
        }
        let outData = stdout.fileHandleForReading.readDataToEndOfFile()
        group.wait()
        process.waitUntilExit()
        watchdog.cancel()

        let out = String(decoding: outData, as: UTF8.self)
        let err = String(decoding: errBox.data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let name = executable.lastPathComponent
        if state.timedOut {
            throw CLIError(message: "`\(name) \(arguments.prefix(2).joined(separator: " "))` timed out after \(Int(timeout))s")
        }
        guard process.terminationStatus == 0 else {
            let detail = err.isEmpty ? out.trimmingCharacters(in: .whitespacesAndNewlines) : err
            throw CLIError(message: detail.isEmpty ? "\(name) exited with status \(process.terminationStatus)" : detail)
        }
        return out
    }
}
