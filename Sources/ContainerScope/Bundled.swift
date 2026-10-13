import Foundation

/// Third-party components shipped inside ContainerScope.app/Contents/Resources, so the app runs
/// without Homebrew or separate downloads. Scripts/fetch-deps.sh stages them, Scripts/build-app.sh
/// embeds them, and ThirdParty/versions.json records what went in.
enum Bundled {
    private static var resources: URL { Bundle.main.resourceURL ?? Bundle.main.bundleURL }

    /// Apple's signed `container` engine, unmodified: bin/ and libexec/ (its install root).
    static var engineRoot: URL { resources.appendingPathComponent("Engine", isDirectory: true) }
    static var engineCLI: URL? { executable(engineRoot.appendingPathComponent("bin/container")) }

    /// The Linux kernel containers boot (the engine's recommended Kata build), so first start
    /// doesn't download the 700 MB Kata release archive to extract it.
    static var kernel: URL? {
        let dir = resources.appendingPathComponent("Kernel", isDirectory: true)
        return (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
            .first { $0.lastPathComponent.hasPrefix("vmlinux") }
    }

    /// qemu-system-aarch64, qemu-img and swtpm with their libraries (QEMU/bin, QEMU/lib).
    static func qemuTool(_ name: String) -> URL? {
        executable(resources.appendingPathComponent("QEMU/bin/\(name)"))
    }

    /// QEMU's data directory (option ROMs, keymaps), passed with -L.
    static var qemuData: URL { resources.appendingPathComponent("QEMU/share/qemu", isDirectory: true) }

    /// Secure Boot UEFI (AAVMF_CODE.ms.fd, AAVMF_VARS.ms.fd, VERSION), trailing zero padding trimmed.
    static var firmware: URL { resources.appendingPathComponent("Firmware", isDirectory: true) }

    /// `{ component: version }` written by Scripts/fetch-deps.sh.
    static var versions: [String: String] {
        guard let data = try? Data(contentsOf: resources.appendingPathComponent("ThirdParty/versions.json")),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
        return object
    }

    private static func executable(_ url: URL) -> URL? {
        FileManager.default.isExecutableFile(atPath: url.path) ? url : nil
    }
}
