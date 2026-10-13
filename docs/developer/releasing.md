# Releasing

Releases are built, signed, notarized and published by GitHub Actions when a `vX.Y.Z` tag is pushed. A release is a GitHub Release with:

- `ContainerScope-X.Y.Z.dmg`: Developer ID–signed, notarized and stapled.
- `ContainerScope-X.Y.Z.dmg.sha256`: its checksum.
- `ContainerScope-X.Y.Z-third-party-sources.tar`: source tarballs of the bundled GPL/LGPL components (see [Bundled dependencies](dependencies.md#licence-compliance)).

## One-time repository setup

The release workflow needs a Developer ID Application certificate and an App Store Connect API key for notarization. Add these under **Settings › Secrets and variables › Actions**:

| Name | Kind | Value |
|---|---|---|
| `SIGN_IDENTITY` | Variable | SHA-1 of the Developer ID Application identity (`security find-identity -v -p codesigning`) |
| `DEVELOPER_ID_P12_BASE64` | Secret | The Developer ID Application certificate and private key exported as `.p12`, base64-encoded (`base64 -i devid.p12 \| pbcopy`) |
| `DEVELOPER_ID_P12_PASSWORD` | Secret | The `.p12` export password |
| `NOTARY_KEY_P8` | Secret | Contents of the App Store Connect API key (`AuthKey_XXXXXXXXXX.p8`), with **Developer** access |
| `NOTARY_KEY_ID` | Secret | The API key's ID |
| `NOTARY_ISSUER` | Secret | The issuer ID from **App Store Connect › Users and Access › Integrations** |

The workflow imports the certificate into a temporary keychain, signs, notarizes, and deletes the keychain and key at the end, even if a step fails.

## Cutting a release

1. Make sure `main` is green in CI.
2. Move the **Unreleased** entries in [CHANGELOG.md](../../CHANGELOG.md) to a new `## [X.Y.Z] - YYYY-MM-DD` section, update the compare links at the bottom, and merge that to `main`.
3. If bundled component versions changed, check that [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and the README's "What's in the app" table match.
4. From an up-to-date, clean `main`:
   ```sh
   Scripts/release.sh X.Y.Z
   ```
   This writes `X.Y.Z` to [`VERSION`](../../VERSION), commits "Release vX.Y.Z", creates the annotated tag `vX.Y.Z` and pushes both. It refuses to run off `main`, with a dirty tree, when `main` differs from `origin/main`, or if the tag exists.
5. Watch the **Release** workflow. When it finishes, edit the GitHub Release notes if needed (it starts from GitHub's generated notes; paste in the changelog section).

## What the release workflow does

[`.github/workflows/release.yml`](../../.github/workflows/release.yml), on a `v*.*.*` tag:

1. **Firmware**: the same reusable [`firmware.yml`](../../.github/workflows/firmware.yml) workflow as CI builds the firmware on `ubuntu-24.04-arm` (cached by the hash of `Firmware/**` and `Scripts/build-firmware.sh`) and hands it over as the `firmware` artifact.
2. **Release** on `macos-26`:
   1. Checks that the tag matches [`VERSION`](../../VERSION) before doing anything else, and fails with `Tag vX.Y.Z does not match VERSION …` if not.
   2. Downloads the `firmware` artifact into `build/deps/firmware` and restores the download cache (`~/Library/Caches/ContainerScope-build`, keyed on `Scripts/deps.env`).
   3. Runs `brew install qemu swtpm zstd && Scripts/fetch-deps.sh` to stage the engine, kernel and QEMU.
   4. Imports the signing identity into a temporary keychain and writes the notary key to a temporary file.
   5. Runs `Scripts/build-app.sh` with `SIGN_IDENTITY`. QEMU, its libraries and the app are signed with the hardened runtime and a secure timestamp; `qemu-system-aarch64` gets the Hypervisor entitlement ([`Scripts/qemu.entitlements`](../../Scripts/qemu.entitlements)); Apple's engine keeps Apple's signature.
   6. Runs `Scripts/build-dmg.sh`, which signs the DMG, submits it to Apple's notary service (`notarytool --wait`), staples the ticket and checks it with `spctl`. The workflow then writes the `.sha256`.
   7. Runs [`Scripts/collect-sources.sh`](../../Scripts/collect-sources.sh) to build `ContainerScope-X.Y.Z-third-party-sources.tar`: the Homebrew source tarball and `.rb` recipe of every bundled formula (listed in `build/deps/qemu/formulae.txt`), plus `linux-6.18.35.tar.xz` and `kata-containers-3.32.0.tar.gz`.
   8. Publishes the GitHub Release with the DMG, `.sha256` and sources tarball, using GitHub's generated notes, and deletes the keychain and notary key even if a step failed.

## Building a signed release locally

You can produce the same DMG on your own Mac if you have the Developer ID certificate in your keychain:

```sh
# once: store notarization credentials in the keychain
xcrun notarytool store-credentials containerscope \
  --key AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <issuer-uuid>

export SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
Scripts/fetch-deps.sh
Scripts/build-app.sh
NOTARY_PROFILE=containerscope Scripts/build-dmg.sh
```

`build-dmg.sh` also accepts `NOTARY_KEY_PATH`, `NOTARY_KEY_ID` and `NOTARY_ISSUER` instead of a keychain profile; that's what CI uses.

## Checking a release

```sh
shasum -a 256 -c ContainerScope-X.Y.Z.dmg.sha256
spctl --assess --type open --context context:primary-signature -v ContainerScope-X.Y.Z.dmg
xcrun stapler validate ContainerScope-X.Y.Z.dmg
```

After installing:

```sh
codesign --verify --strict --deep -v /Applications/ContainerScope.app
spctl --assess -v /Applications/ContainerScope.app
codesign -d --entitlements - /Applications/ContainerScope.app/Contents/Resources/QEMU/bin/qemu-system-aarch64
```

Then smoke-test on a clean user account: the engine starts with the bundled kernel, a container runs, and a Windows VM boots to Windows Setup.

## If something goes wrong

- **"Set the SIGN_IDENTITY variable and the signing secrets"**: one of the settings above is missing.
- **Tag doesn't match VERSION**: the tag was pushed by hand. Delete it (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`) and use `Scripts/release.sh`.
- **Notarization rejected**: get the log with `xcrun notarytool log <submission-id> …`. The usual causes are a binary signed without the hardened runtime or timestamp, or a new unsigned file in the bundle (for example a new dylib QEMU started loading).
- **Re-running a release**: delete the GitHub Release and tag, fix the problem on `main`, and run `Scripts/release.sh` with the next patch version (or the same version if nothing was published).
