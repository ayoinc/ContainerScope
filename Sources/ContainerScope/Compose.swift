import Foundation

/// Docker Compose driven against socktainer's Docker Engine API socket, so Compose
/// projects run as Apple container containers. Argv-only, like `ContainerCLI`.
enum Compose {
    static let docker: URL? = ["/opt/homebrew/bin/docker", "/usr/local/bin/docker"]
        .first { FileManager.default.isExecutableFile(atPath: $0) }
        .map(URL.init(fileURLWithPath:))

    static let socktainer: String? = ["/opt/homebrew/bin/socktainer", "/usr/local/bin/socktainer"]
        .first { FileManager.default.isExecutableFile(atPath: $0) }

    /// What the Orchestration page needs to decide between a working engine and setup steps.
    static func statusJSON() async -> String {
        var compose: String?
        if let docker {
            compose = try? await ContainerCLI.run(docker, ["compose", "version", "--short"], timeout: 15)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let info: [String: Any] = [
            "docker": docker?.path as Any,
            "compose": compose as Any,
            "socktainer": socktainer as Any,
            "socket": HostInfo.dockerSocket() as Any,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    static func run(_ arguments: [String], timeout: TimeInterval = 30) async throws -> String {
        guard let docker else {
            throw CLIError(message: "Docker CLI not found. Install it with: brew install docker docker-compose")
        }
        guard let socket = HostInfo.dockerSocket() else {
            throw CLIError(message: "No socktainer socket found. Start it with: brew services start socktainer")
        }
        return try await ContainerCLI.run(docker, ["--host", "unix://\(socket)", "compose"] + arguments, timeout: timeout)
    }
}
