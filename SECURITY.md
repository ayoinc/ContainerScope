# Security policy

## Supported versions

Only the latest release of ContainerScope gets security fixes. Fixes ship as a new release; there are no backports to older versions.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No — update to the latest release |

ContainerScope bundles Apple's `container` engine, a Linux kernel, QEMU, swtpm and UEFI firmware (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). When one of those has a security fix that affects ContainerScope, it reaches you as a ContainerScope update. If you installed the engine yourself with Homebrew, ContainerScope uses that one instead and you update it from the **Engine** page or with `brew upgrade container`.

## Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub's private vulnerability reporting:

**<https://github.com/ayoinc/ContainerScope/security/advisories/new>**

Include as much as you can:

- what the problem is and what an attacker could do with it;
- the ContainerScope version (**ContainerScope › About ContainerScope**) and macOS version;
- steps to reproduce, a proof of concept, or the relevant logs;
- whether the problem is in ContainerScope's own code or in a bundled component.

What to expect:

- an acknowledgement within a few days;
- updates in the advisory as the problem is investigated and fixed;
- credit in the advisory and release notes when the fix ships, unless you'd rather stay anonymous.

If the problem is in a bundled upstream component (for example QEMU or Apple's `container`), please also report it to that project. We'll update the bundled copy once a fix is available.

## Scope

In scope: the ContainerScope app, its build and release scripts, the release workflow, and the way it bundles, signs and runs third-party components.

Out of scope: vulnerabilities in container images you pull, in Windows itself, or in upstream components that ContainerScope doesn't make worse — report those upstream.
