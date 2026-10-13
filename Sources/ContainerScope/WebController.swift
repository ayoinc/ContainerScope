import SwiftUI
import WebKit

/// Owns the single WKWebView that renders the content layer and its JS bridge.
@MainActor
final class WebController: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private let bridge: Bridge

    init(model: AppModel) {
        let contentController = WKUserContentController()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.isInspectable = true
        webView.allowsMagnification = false

        bridge = Bridge(cli: model.cli, model: model)
        super.init()
        bridge.webView = webView
        webView.navigationDelegate = self
        contentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "bridge")
        load()
    }

    /// The UI is a single local page: anything else (a link in a log line, a release URL) opens in the browser.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.isFileURL { return .allow }
        if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        return .cancel
    }

    /// WebKit runs content out of process; if it dies, bring the UI back (it re-reads the route on load).
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }

    func call(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func load() {
        guard let root = Self.webRoot() else {
            webView.loadHTMLString("<p style='font:13px -apple-system;padding:40px'>Web resources missing.</p>", baseURL: nil)
            return
        }
        webView.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
    }

    /// Bundled `.app` → Contents/Resources/Web. `swift run` → the source tree next to this file.
    private static func webRoot() -> URL? {
        let fm = FileManager.default
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("Web"),
           fm.fileExists(atPath: bundled.appendingPathComponent("index.html").path) {
            return bundled
        }
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Web")
        return fm.fileExists(atPath: source.appendingPathComponent("index.html").path) ? source : nil
    }
}

struct WebContentView: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
