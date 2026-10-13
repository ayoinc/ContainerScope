import Foundation
import Virtualization

/// Host facts that decide which virtualization features the UI can offer.
/// Uses Virtualization.framework's own capability APIs rather than guessing from the chip name.
enum HostInfo {
    static func json() -> String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let rosetta: String = switch VZLinuxRosettaDirectoryShare.availability {
        case .installed: "installed"
        case .notInstalled: "notInstalled"
        case .notSupported: "notSupported"
        @unknown default: "unknown"
        }
        let info: [String: Any] = [
            "chip": sysctlString("machdep.cpu.brand_string") ?? "Unknown",
            "model": sysctlString("hw.model") ?? "",
            "cpus": ProcessInfo.processInfo.activeProcessorCount,
            "memoryBytes": ProcessInfo.processInfo.physicalMemory,
            "macOS": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            "hypervisor": sysctlInt("kern.hv_support") == 1,
            "nestedVirtualization": VZGenericPlatformConfiguration.isNestedVirtualizationSupported,
            "rosetta": rosetta,
            "dockerSocket": dockerSocket() as Any,
            "homebrew": ContainerCLI.homebrew?.path as Any,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// Shows the system's own Rosetta license/consent prompt; required by `container k8s` node VMs.
    @MainActor
    static func installRosetta() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            VZLinuxRosettaDirectoryShare.installRosetta { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    /// socktainer exposes a Docker Engine API on top of Apple container; Vagrant/Docker clients can target it.
    /// Checked: per-user launch, then Homebrew services (`brew services start socktainer`).
    private static func dockerSocket() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            "\(home)/.socktainer/container.sock",
            "/opt/homebrew/var/run/socktainer/.socktainer/container.sock",
            "/usr/local/var/run/socktainer/.socktainer/container.sock",
        ].first { FileManager.default.fileExists(atPath: $0) }
    }

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }

    private static func sysctlInt(_ name: String) -> Int32? {
        var value: Int32 = 0
        var size = MemoryLayout<Int32>.size
        return sysctlbyname(name, &value, &size, nil, 0) == 0 ? value : nil
    }
}

/// Latest apple/container release, for the Engine page's update check.
enum ReleaseCheck {
    static func latest() async throws -> String {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/apple/container/releases/latest")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CLIError(message: "GitHub release lookup failed")
        }
        let result: [String: Any] = [
            "tag": json["tag_name"] as? String ?? "",
            "publishedAt": json["published_at"] as? String ?? "",
            "url": json["html_url"] as? String ?? "",
        ]
        return String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
    }
}
