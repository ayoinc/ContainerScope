import Foundation

/// Answers "should containers on this network reach the internet, and do they?" and, when they
/// don't, why. Distinguishes networks that are private by design (`--internal`, host-only)
/// from NAT networks whose egress is being blocked on the host (typically a VPN kill switch).
enum NetworkHealth {
    /// VPN clients known to own the default route and filter the vmnet bridge.
    private static let vpnApps: [(match: String, name: String, fix: String)] = [
        ("nordvpn", "NordVPN", "Open NordVPN and press Disconnect, or in Settings turn on Local Network visibility (allow LAN traffic) / turn off Kill Switch, then re-test. Quitting the NordVPN app is not enough: its helper keeps the tunnel up."),
        ("tailscale", "Tailscale", "Disable “Use exit node” or allow LAN access in Tailscale, then re-test."),
        ("warp", "Cloudflare WARP", "In WARP › Preferences › Advanced, exclude 192.168.64.0/24 (Split Tunnels) or disconnect, then re-test."),
        ("wireguard", "WireGuard", "Exclude 192.168.64.0/24 from AllowedIPs or disable “Block untunneled traffic” (kill switch), then re-test."),
        ("globalprotect", "GlobalProtect", "Your organisation's GlobalProtect policy blocks local traffic; ask IT for split tunnelling or disconnect, then re-test."),
        ("cisco", "Cisco Secure Client", "Enable “Allow local (LAN) access” in Cisco Secure Client preferences, or disconnect, then re-test."),
        ("forti", "FortiClient", "Enable split tunnelling for local networks in FortiClient, or disconnect, then re-test."),
        ("zscaler", "Zscaler", "Zscaler is intercepting traffic; ask IT to bypass 192.168.64.0/24, or disable Internet Security, then re-test."),
        ("proton", "Proton VPN", "Turn on “Allow LAN connections” in Proton VPN settings or turn off Kill Switch, then re-test."),
        ("mullvad", "Mullvad VPN", "Turn on “Local network sharing” in Mullvad settings, then re-test."),
        ("expressvpn", "ExpressVPN", "Turn on “Allow access to devices on the local network” in ExpressVPN, then re-test."),
        ("surfshark", "Surfshark", "Turn off Kill Switch or enable local network access in Surfshark, then re-test."),
        ("tunnelblick", "Tunnelblick", "Disable “Route all IPv4 traffic through the VPN” for this configuration, then re-test."),
    ]

    static func diagnose(network: String, cli: ContainerCLI) async throws -> String {
        let networks = try await cli.run(["network", "list", "--format", "json"])
        let list = (try JSONSerialization.jsonObject(with: Data(networks.utf8)) as? [[String: Any]]) ?? []
        guard let entry = list.first(where: { $0["id"] as? String == network }),
              let configuration = entry["configuration"] as? [String: Any] else {
            throw CLIError(message: "Network “\(network)” not found")
        }
        let mode = configuration["mode"] as? String ?? "unknown"

        async let hostOnline = hostHasInternet()
        async let route = defaultRouteInterface()
        // Only blame a VPN when the default route actually runs through a tunnel interface.
        let vpn = (await route)?.hasPrefix("utun") == true ? await runningVPN() : nil

        var result: [String: Any] = [
            "network": network,
            "mode": mode,
            "checkedAt": ISO8601DateFormatter().string(from: Date()),
            "routeInterface": await route as Any,
            "vpn": vpn?.name as Any,
        ]
        let online = await hostOnline
        result["hostOnline"] = online

        guard mode == "nat" else {
            result["verdict"] = "isolated"
            result["summary"] = "Private network: no internet by design"
            result["detail"] = "“\(network)” is host-only (created with --internal). Containers reach each other and the host, not the internet."
            return encode(result)
        }

        // Ephemeral probe on the same network: DNS (answered inside vmnet) vs real egress.
        let probe = (try? await cli.run([
            "run", "--rm", "--network", network, "--cpus", "1", "--memory", "256M",
            "docker.io/library/alpine:latest", "sh", "-c",
            "nslookup captive.apple.com >/dev/null 2>&1 && echo dns-ok; " +
            "wget -q -T 5 -O - http://captive.apple.com/hotspot-detect.html 2>/dev/null | grep -q Success && echo http-ok; true",
        ], timeout: 180)) ?? ""
        let dns = probe.contains("dns-ok")
        let http = probe.contains("http-ok")
        result["dns"] = dns
        result["egress"] = http

        switch (http, online) {
        case (true, _):
            result["verdict"] = "ok"
            result["summary"] = "Containers have internet access"
            result["detail"] = "DNS and HTTP egress from “\(network)” both work."
        case (false, false):
            result["verdict"] = "hostOffline"
            result["summary"] = "This Mac is offline"
            result["detail"] = "The host itself can't reach the internet, so containers can't either."
        case (false, true):
            result["verdict"] = "blocked"
            let routeName = await route ?? "unknown"
            if let vpn {
                result["summary"] = "\(vpn.name) is blocking container traffic"
                result["detail"] = "The Mac reaches the internet through \(vpn.name) (\(routeName)), but its firewall drops traffic from the container bridge, so containers get DNS\(dns ? "" : " (failing too)") and no connections. Image pulls still work because they run on the host."
                result["fix"] = vpn.fix
            } else if routeName.hasPrefix("utun") {
                result["summary"] = "A VPN is blocking container traffic"
                result["detail"] = "The default route goes through \(routeName), a VPN tunnel that drops traffic from the container bridge."
                result["fix"] = "Allow local network (LAN) access or exclude 192.168.64.0/24 in your VPN, or disconnect it, then re-test."
            } else {
                result["summary"] = "Container NAT isn't forwarding traffic"
                result["detail"] = "The Mac is online but traffic from “\(network)” doesn't leave the host. A content filter or firewall may be blocking the bridge, or vmnet's NAT is stuck."
                result["fix"] = "Restart container services to rebuild the vmnet NAT, then re-test. If it persists, check Network Extensions in System Settings › General › Login Items & Extensions."
                result["canRestart"] = true
            }
        }
        return encode(result)
    }

    static func defaultRouteInterface() async -> String? {
        guard let out = try? await ContainerCLI.run(URL(fileURLWithPath: "/sbin/route"), ["-n", "get", "default"], timeout: 5) else { return nil }
        return out.split(separator: "\n")
            .first { $0.contains("interface:") }?
            .split(separator: ":").last?
            .trimmingCharacters(in: .whitespaces)
    }

    /// Scans the process table (not just GUI apps): VPN tunnels and kill switches live in helpers
    /// and daemons that keep running after the client app quits.
    private static func runningVPN() async -> (name: String, fix: String)? {
        guard let table = try? await ContainerCLI.run(URL(fileURLWithPath: "/bin/ps"), ["-axco", "command="], timeout: 5) else { return nil }
        let names = table.lowercased()
        return vpnApps.first { names.contains($0.match) }.map { ($0.name, $0.fix) }
    }

    private static func hostHasInternet() async -> Bool {
        var request = URLRequest(url: URL(string: "http://captive.apple.com/hotspot-detect.html")!)
        request.timeoutInterval = 6
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200 && String(decoding: data, as: UTF8.self).contains("Success")
    }

    private static func encode(_ value: [String: Any]) -> String {
        String(decoding: (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8), as: UTF8.self)
    }
}
