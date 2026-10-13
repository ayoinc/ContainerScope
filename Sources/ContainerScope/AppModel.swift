import Foundation
import Observation

enum Route: String, CaseIterable, Identifiable {
    case overview, containers, images, volumes, networks, machines, windows, kubernetes, engine

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .containers: "Containers"
        case .images: "Images"
        case .volumes: "Volumes"
        case .networks: "Networks"
        case .machines: "Machines"
        case .windows: "Windows"
        case .kubernetes: "Kubernetes"
        case .engine: "Engine"
        }
    }

    var symbol: String {
        switch self {
        case .overview: "gauge.with.dots.needle.33percent"
        case .containers: "shippingbox"
        case .images: "square.stack.3d.up"
        case .volumes: "externaldrive"
        case .networks: "network"
        case .machines: "desktopcomputer"
        case .windows: "pc"
        case .kubernetes: "helm"
        case .engine: "engine.combustion"
        }
    }

    /// Sidebar groups — two levels at most (HIG Sidebars).
    static let sections: [(title: String, routes: [Route])] = [
        ("Containers", [.overview, .containers, .images, .volumes, .networks]),
        ("Virtualization", [.machines, .windows, .kubernetes]),
        ("System", [.engine]),
    ]
}

/// In-app override of the system appearance; persisted in user defaults.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

/// Subset of `container system status --format json` the native chrome needs.
struct SystemStatus: Decodable, Equatable {
    struct Server: Decodable, Equatable { let version: String }
    struct Resources: Decodable, Equatable {
        let containersRunning: Int
        let containersTotal: Int
        let images: Int
    }
    let status: String
    let server: Server?
    let resources: Resources?

    var isRunning: Bool { status == "running" }
}

@MainActor
@Observable
final class AppModel {
    var route: Route = .overview {
        didSet {
            guard route != oldValue else { return }
            if routeChangedByWeb {
                routeChangedByWeb = false
            } else {
                web.call("window.app?.navigate('\(route.rawValue)')")
            }
        }
    }
    private(set) var status: SystemStatus?
    private(set) var statusError: String?
    private(set) var isStartingServices = false
    var appearance: Appearance = Appearance(rawValue: UserDefaults.standard.string(forKey: "appearance") ?? "") ?? .system {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: "appearance") }
    }

    let cli = ContainerCLI()
    @ObservationIgnored private var routeChangedByWeb = false
    @ObservationIgnored private(set) lazy var web = WebController(model: self)
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    init() {
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshStatus()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    /// The web layer navigated internally (e.g. an Overview card link); mirror it in the sidebar.
    func routeFromWeb(_ route: Route) {
        guard route != self.route else { return }
        routeChangedByWeb = true
        self.route = route
    }

    func refresh() {
        web.call("window.app?.refresh()")
        Task { await refreshStatus() }
    }

    /// Engine actions run through the bridge; chrome and data both need to catch up afterwards.
    func refreshAfterServiceChange() {
        Task {
            await refreshStatus()
            web.call("window.app?.refresh()")
        }
    }

    func startServices() {
        isStartingServices = true
        Task {
            defer { isStartingServices = false }
            do {
                _ = try await cli.run(["system", "start", "--disable-kernel-install"], timeout: 120)
            } catch {
                statusError = error.localizedDescription
            }
            await refreshStatus()
            web.call("window.app?.refresh()")
        }
    }

    private func refreshStatus() async {
        do {
            let json = try await cli.run(["system", "status", "--format", "json"], timeout: 10)
            status = try JSONDecoder().decode(SystemStatus.self, from: Data(json.utf8))
            statusError = nil
        } catch {
            status = nil
            statusError = error.localizedDescription
        }
    }
}
