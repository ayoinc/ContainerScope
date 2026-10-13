import Foundation

struct CLIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Runs the Apple `container` CLI with an argv array (never through a shell).
struct ContainerCLI: Sendable {
    let executable: URL?

    init() {
        executable = Self.locate()
    }

    /// GUI apps inherit a minimal PATH, so probe the known install locations explicitly.
    private static func locate() -> URL? {
        let fm = FileManager.default
        var candidates: [String] = []
        if let override = ProcessInfo.processInfo.environment["CONTAINER_BIN"] { candidates.append(override) }
        candidates += ["/opt/homebrew/bin/container", "/usr/local/bin/container"]
        if let path = ProcessInfo.processInfo.environment["PATH"] {
            candidates += path.split(separator: ":").map { "\($0)/container" }
        }
        return candidates.first { fm.isExecutableFile(atPath: $0) }.map(URL.init(fileURLWithPath:))
    }

    func run(_ arguments: [String], timeout: TimeInterval = 30) async throws -> String {
        guard let executable else {
            throw CLIError(message: "The `container` CLI was not found in /opt/homebrew/bin or /usr/local/bin. Set CONTAINER_BIN to its path.")
        }
        return try await Self.run(executable, arguments, timeout: timeout)
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
