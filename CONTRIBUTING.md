# Contributing to ContainerScope

Thanks for helping. Bug reports, ideas, documentation fixes and pull requests are all welcome.

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md). Please don't report security problems in public issues; see [SECURITY.md](SECURITY.md).

## Reporting a bug

[Open an issue](https://github.com/ayoinc/ContainerScope/issues/new) with:

- ContainerScope version (**ContainerScope › About ContainerScope**), macOS version and Mac model (chip).
- Which engine it uses (shown on **System › Engine**: bundled or Homebrew, and its version).
- What you did, what you expected and what happened. Screenshots help.
- Relevant logs:
  - Engine: `container system logs --last 10m`
  - Windows VMs: `~/Library/Application Support/ContainerScope/Windows/<name>/qemu.log`

Check [Troubleshooting](docs/user/troubleshooting.md) first; many problems (VPNs blocking container networking, a second engine running) are covered there.

## Suggesting a feature

Open an issue describing the problem you want solved before writing a large change, so we can agree on the approach. ContainerScope deliberately stays a thin, native front end for Apple's `container` engine and QEMU; features that belong in the engine itself are better proposed to [apple/container](https://github.com/apple/container).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Set up a build: see [Building](docs/developer/building.md). [Architecture](docs/developer/architecture.md) explains how the pieces fit.
3. Make your change. Keep pull requests focused on one thing.
4. Build and try it: `Scripts/build-app.sh && open build/ContainerScope.app`. Exercise the pages you touched, in both light and dark appearance.
5. Add an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
6. Update the docs in [`docs/`](docs) if behaviour changes.
7. Open a pull request explaining what changed and why, and how you tested it. CI must pass.

### Guidelines

- **Swift:** Swift 6 with strict concurrency, no third-party packages. Follow the style of the surrounding code.
- **Web UI:** plain JavaScript and CSS in `Sources/ContainerScope/Web`, no frameworks or build step. Use the existing helpers in `core.js` and the design tokens in `tokens.css`.
- **Bridge methods:** every new method in `Bridge.swift` must validate its parameters before they reach an argument list, run commands with argument arrays (never a shell), and confirm destructive actions with a native alert. See [Architecture › The bridge](docs/developer/architecture.md#the-bridge).
- **Bundled components:** changing a bundled version means updating `Scripts/deps.env` with a checksum, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the README. See [Bundled dependencies](docs/developer/dependencies.md).
- **Writing in the UI and docs:** short, plain sentences; tell people what to do, not how the code works.
- Don't commit `build/`, ISOs, disk images or firmware images.

## Licence

ContainerScope is licensed under the [Apache License 2.0](LICENSE). Unless you say otherwise, any contribution you submit is licensed under the same terms, as described in section 5 of the licence. You don't need to sign a CLA.
