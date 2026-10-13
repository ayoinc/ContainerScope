// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ContainerScope",
    // Apple `container` requires macOS 26; targeting it also stamps SDK 26 into the binary,
    // which AppKit uses to opt the window into the Liquid Glass design.
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "ContainerScope",
            path: "Sources/ContainerScope",
            exclude: ["Web"]
        ),
    ]
)
