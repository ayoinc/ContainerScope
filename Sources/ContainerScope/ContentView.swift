import SwiftUI

struct ContentView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationSplitView {
            List(selection: selection) {
                ForEach(Route.sections, id: \.title) { section in
                    Section(section.title) {
                        ForEach(section.routes) { route in
                            Label(route.title, systemImage: route.symbol)
                                .badge(badge(for: route))
                                .tag(route)
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
        } detail: {
            WebContentView(webView: model.web.webView)
                .navigationTitle(model.route.title)
                .navigationSubtitle(subtitle)
                .toolbar {
                    ToolbarItem(placement: .status) { StatusIndicator(model: model) }
                    ToolbarItem(placement: .primaryAction) {
                        Button { model.refresh() } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .help("Refresh (⌘R)")
                    }
                }
        }
        .preferredColorScheme(model.appearance == .dark ? .dark : model.appearance == .light ? .light : nil)
    }

    /// `List(selection:)` needs an optional binding; the sidebar never deselects.
    private var selection: Binding<Route?> {
        Binding(get: { model.route }, set: { if let route = $0 { model.route = route } })
    }

    /// Running count only: `system status` counts images that `image list` doesn't show,
    /// so an image badge would disagree with the Images table.
    private func badge(for route: Route) -> Int {
        route == .containers ? model.status?.resources?.containersRunning ?? 0 : 0
    }

    private var subtitle: String {
        guard let resources = model.status?.resources, model.route == .overview || model.route == .containers else { return "" }
        return "\(resources.containersRunning) of \(resources.containersTotal) running"
    }
}

private struct StatusIndicator: View {
    let model: AppModel

    var body: some View {
        if let status = model.status, status.isRunning {
            Label {
                Text("Running · v\(status.server?.version ?? "?")")
                    .foregroundStyle(.secondary)
            } icon: {
                Image(systemName: "circle.fill")
                    .foregroundStyle(.green)
                    .imageScale(.small)
            }
            .labelStyle(.titleAndIcon)
            .help("container-apiserver is running")
        } else {
            Button {
                model.startServices()
            } label: {
                Label(model.isStartingServices ? "Starting…" : "Start Services", systemImage: "power")
            }
            .disabled(model.isStartingServices)
            .help(model.statusError ?? "container services are stopped")
        }
    }
}
