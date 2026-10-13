import SwiftUI

@main
struct ContainerScopeApp: App {
    /// The App value is created once per process; a plain stored property avoids the `@State`
    /// macro, whose plugin ships only with Xcode (not the Command Line Tools).
    private let model = AppModel()

    var body: some Scene {
        Window("ContainerScope", id: "main") {
            ContentView(model: model)
                .frame(minWidth: 980, minHeight: 620)
        }
        .defaultSize(width: 1320, height: 860)
        .windowToolbarStyle(.unified)
        .commands {
            SidebarCommands()
            CommandGroup(after: .sidebar) {
                Button("Refresh") { model.refresh() }
                    .keyboardShortcut("r")
                Divider()
                ForEach(Array(Route.allCases.enumerated()), id: \.element) { index, route in
                    Button(route.title) { model.route = route }
                        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")))
                }
                Divider()
                Picker("Appearance", selection: Bindable(model).appearance) {
                    ForEach(Appearance.allCases) { Text($0.title).tag($0) }
                }
                Divider()
            }
        }
    }
}
