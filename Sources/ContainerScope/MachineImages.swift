import Foundation

/// Linux distributions offered on the Linux page. Stock distro images are made for app
/// containers: most lack `/sbin/init`, and none ship `sudo`, so `container machine create`
/// either fails or leaves the user without the passwordless sudo it configures. Each preset is
/// therefore layered once into a local machine image (init system + sudo) with `container build`,
/// then reused for every machine created from it.
enum MachineImages {
    enum Family: String { case apt, dnf, zypper, apk }

    struct Preset {
        let id: String
        let name: String
        let base: String
        let note: String
        let family: Family

        /// Local tag of the prepared machine image.
        var tag: String { "containerscope/machine-\(id):latest" }
    }

    /// Each was built, booted as a machine (systemd or BusyBox init as PID 1, passwordless sudo,
    /// DNS) on Apple silicon. Arch Linux is absent: its official image is amd64-only.
    static let presets: [Preset] = [
        Preset(id: "ubuntu-24.04", name: "Ubuntu 24.04 LTS", base: "docker.io/library/ubuntu:24.04", note: "Long-term support until 2029 · systemd", family: .apt),
        Preset(id: "ubuntu-22.04", name: "Ubuntu 22.04 LTS", base: "docker.io/library/ubuntu:22.04", note: "Previous LTS, supported until 2027 · systemd", family: .apt),
        Preset(id: "debian-13", name: "Debian 13 “Trixie”", base: "docker.io/library/debian:13", note: "Current stable · systemd", family: .apt),
        Preset(id: "debian-12", name: "Debian 12 “Bookworm”", base: "docker.io/library/debian:12", note: "Previous stable, LTS until 2028 · systemd", family: .apt),
        Preset(id: "fedora", name: "Fedora (latest)", base: "docker.io/library/fedora:latest", note: "Newest packages, released every 6 months · systemd", family: .dnf),
        Preset(id: "rocky-10", name: "Rocky Linux 10", base: "docker.io/rockylinux/rockylinux:10", note: "RHEL 10 compatible · systemd", family: .dnf),
        Preset(id: "rocky-9", name: "Rocky Linux 9", base: "docker.io/rockylinux/rockylinux:9", note: "RHEL 9 compatible · systemd", family: .dnf),
        Preset(id: "almalinux-10", name: "AlmaLinux 10", base: "docker.io/library/almalinux:10", note: "RHEL 10 compatible · systemd", family: .dnf),
        Preset(id: "almalinux-9", name: "AlmaLinux 9", base: "docker.io/library/almalinux:9", note: "RHEL 9 compatible · systemd", family: .dnf),
        Preset(id: "opensuse-leap-15.6", name: "openSUSE Leap 15.6", base: "docker.io/opensuse/leap:15.6", note: "SUSE Linux Enterprise based · systemd", family: .zypper),
        Preset(id: "alpine-3.22", name: "Alpine Linux 3.22", base: "docker.io/library/alpine:3.22", note: "Tiny musl + BusyBox init, boots in about a second", family: .apk),
    ]

    static func preset(_ id: String) throws -> Preset {
        guard let preset = presets.first(where: { $0.id == id }) else { throw CLIError(message: "Unknown Linux distribution") }
        return preset
    }

    static func presetsJSON() -> String {
        let list = presets.map { ["id": $0.id, "name": $0.name, "ref": $0.base, "note": $0.note] }
        let data = (try? JSONSerialization.data(withJSONObject: list)) ?? Data("[]".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// Returns the prepared image's tag, building it the first time.
    static func prepare(_ preset: Preset, cli: ContainerCLI) async throws -> String {
        if (try? await cli.run(["image", "inspect", preset.tag])) != nil { return preset.tag }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("containerscope-machine-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try dockerfile(preset).write(to: directory.appendingPathComponent("Dockerfile"), atomically: true, encoding: .utf8)
        _ = try await cli.run(["build", "--progress", "plain", "--tag", preset.tag, directory.path], timeout: 1800)
        return preset.tag
    }

    /// Same systemd preparation as Apple's container-machine guide: boot to multi-user, skip units
    /// that need hardware or host state a machine doesn't have.
    private static let systemdSetup = """
        RUN : > /etc/machine-id && systemctl set-default multi-user.target && \\
            systemctl mask dev-hugepages.mount sys-fs-fuse-connections.mount systemd-update-utmp.service \\
            systemd-tmpfiles-setup.service console-getty.service
        """

    static func dockerfile(_ preset: Preset) -> String {
        let install: String
        switch preset.family {
        case .apt:
            install = """
                RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
                    systemd systemd-sysv dbus sudo ca-certificates iproute2 iputils-ping curl procps less && \\
                    rm -rf /var/lib/apt/lists/*
                \(systemdSetup)
                """
        case .dnf:
            install = """
                RUN dnf -y install systemd dbus sudo iproute iputils procps-ng && dnf clean all
                \(systemdSetup)
                """
        case .zypper:
            install = """
                RUN zypper -n install --no-recommends systemd systemd-sysvinit sudo iproute2 iputils procps && zypper clean -a
                \(systemdSetup)
                """
        case .apk:
            install = "RUN apk add --no-cache sudo"
        }
        return """
            FROM \(preset.base)
            ENV container=container
            \(install)

            """
    }
}
