import AppKit
import WebKit

/// Official Windows on ARM install media from Microsoft's download page.
/// Microsoft only issues signed, 24-hour links to a real browser session (its fraud check rejects
/// direct API calls), so a hidden, non-persistent WKWebView drives the page's own form:
/// edition → Confirm → language → Confirm, then reads the link the page renders.
@MainActor
final class MicrosoftISO: NSObject, WKNavigationDelegate {
    static let shared = MicrosoftISO()
    static let page = URL(string: "https://www.microsoft.com/en-us/software-download/windows11arm64")!

    private var pageLoaded: CheckedContinuation<Void, Error>?
    private var cachedCatalog: String?

    /// `{ editions: [{id, name}], languages: [name] }` for the newest Arm64 edition.
    func catalog() async throws -> String {
        if let cachedCatalog { return cachedCatalog }
        let result = try await runOnPage(edition: nil, language: nil)
        cachedCatalog = result
        return result
    }

    /// A fresh signed download link for one edition and language.
    func link(edition: String, language: String) async throws -> URL {
        let json = try await runOnPage(edition: edition, language: language)
        guard let data = json.data(using: .utf8),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let href = object["href"] as? String, let url = URL(string: href), url.scheme == "https",
              url.host?.hasSuffix(".microsoft.com") == true else {
            throw CLIError(message: "Microsoft didn't return a download link. Try again in a minute.")
        }
        return url
    }

    private func runOnPage(edition: String?, language: String?) async throws -> String {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: configuration)
        web.navigationDelegate = self
        try await withCheckedThrowingContinuation { continuation in
            pageLoaded = continuation
            web.load(URLRequest(url: Self.page, timeoutInterval: 30))
        }
        let result = try await web.callAsyncJavaScript(Self.script, arguments: [
            "wantEdition": edition ?? "", "wantLanguage": language ?? "",
        ], contentWorld: .page)
        guard let text = result as? String else { throw CLIError(message: "Microsoft's download page changed; use a pasted link instead.") }
        if let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = object["error"] as? String, !error.isEmpty {
            throw CLIError(message: "Microsoft: \(error)")
        }
        return text
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            pageLoaded?.resume()
            pageLoaded = nil
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.fail(error) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.fail(error) }
    }

    private func fail(_ error: Error) {
        pageLoaded?.resume(throwing: CLIError(message: "Couldn't open Microsoft's download page: \(error.localizedDescription)"))
        pageLoaded = nil
    }

    /// Runs in the page. With no language it stops after listing languages.
    private static let script = """
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (f, ms = 25000) => { for (let t = 0; t < ms; t += 250) { const v = f(); if (v) return v; await wait(250); } return null; };
    const pageError = () => document.querySelector("#errorModalMessage, .alert-danger, [role=alert]")?.textContent?.trim().slice(0, 300) || "";

    const editionSelect = await until(() => document.querySelector("#product-edition"));
    if (!editionSelect) return JSON.stringify({ error: "the edition list didn't load" });
    const editions = [...editionSelect.options].filter((o) => o.value && /arm64/i.test(o.text)).map((o) => ({ id: o.value, name: o.text.trim() }));
    if (!editions.length) return JSON.stringify({ error: "no Arm64 edition is offered right now" });
    const edition = editions.find((e) => e.id === wantEdition) || editions[0];
    editionSelect.value = edition.id;
    editionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#submit-product-edition").click();

    const languageSelect = await until(() => { const s = document.querySelector("#product-languages"); return s && s.options.length > 1 ? s : null; });
    if (!languageSelect) return JSON.stringify({ error: pageError() || "the language list didn't load" });
    const languages = [...languageSelect.options].filter((o) => o.value).map((o) => o.text.trim());
    if (!wantLanguage) return JSON.stringify({ editions, edition: edition.id, languages });

    const option = [...languageSelect.options].find((o) => o.text.trim() === wantLanguage);
    if (!option) return JSON.stringify({ error: `language “${wantLanguage}” isn't offered` });
    languageSelect.value = option.value;
    languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(400);
    document.querySelector("#submit-sku").click();
    const link = await until(() => [...document.querySelectorAll("a")].find((a) => /\\.iso(\\?|$)/i.test(a.href)), 30000);
    return JSON.stringify(link ? { href: link.href } : { error: pageError() || "no download link appeared" });
    """
}
