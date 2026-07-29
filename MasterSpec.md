# Ecosystem Rolling Release Specification (Master Plan)

## 1. Objective

To construct an automated, scalable rolling release engine for an ecosystem of $M$ upstream packages and $N$ downstream packages. The system must eliminate manual version coordination, prevent release spam through intelligent filtering and batching, handle structural differences between libraries and applications, and support multi-hop transitive propagation.

## 2. Core Architecture Components

* **Topographical Mapper (Stage 1):** A scheduled/manual crawler that parses all GitHub repository manifests (`package.json`) across the organization and outputs a living dependency graph (`dependency-map.json`).
* **Ingress Hub:** A centralized GitHub Actions workflow (`handle-release.yml`) that listens to release events via `workflow_call` or `workflow_dispatch`, capturing package metadata, version numbers, and the originating caller identity.
* **Smart Semver Filter Engine:** Uses Bun’s native semver evaluation (`semver.satisfies`) to determine whether downstream consumers actually require a `package.json` version bump or if their existing ranges already cover the new release.
* **Debounced Queue System:** Aggregates incoming release events into a centralized queue window ($T$ minutes) to prevent update thrashing and clustering race conditions.

## 3. Classification of Downstream Actions (The 3 PR/Update Types)

Depending on the consumer type and graph position, downstream updates are categorized into three distinct execution paths:

1. **Type 1: Library Manifest Bump (`package.json`)**
* *Target:* Downstream libraries whose existing semver constraints do not cover the new upstream version.
* *Action:* Programmatically update `package.json` constraint, open a Pull Request, and trigger downstream builds/tests.


2. **Type 2: Application Release (`bun.lock`-based)**
* *Target:* Downstream **Applications** (services, frontends, CLIs) rather than libraries.
* *Action:* Applications *do* ship/deploy with lockfiles. Even if their semver range is satisfied, their lockfile must be regenerated (`bun update`) to pull in the binary/artifact updates for deployment.


3. **Type 3: Transitive Multi-Hop Cascade**
* *Target:* Intermediate libraries whose semver range *already* satisfies the update (e.g., they use `^2.0.0` and `2.1.0` dropped).
* *Action:* Skip `package.json` modifications locally, but **re-emit/propagate the release event** downstream so that *their* children (which might have tighter constraints or be apps) still receive the update signal.

