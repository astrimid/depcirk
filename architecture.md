# depcirk Architecture & Design

`depcirk` is a lightweight, distributed dependency automation system designed specifically for large JavaScript/TypeScript polyrepo ecosystems powered by `Bun`. Instead of wrestling with monorepo CI bottlenecks or manually updating cascading dependencies across hundreds of independent repositories, `depcirk` centralizes orchestration using a **Three-Action Architecture**.


## High-Level Architecture Overview

The system splits responsibilities into three distinct, specialized GitHub Actions managed by a single central hub repository (the "Orchestrator").

```
[ Any Component Repo (1 of 370+) ]
│
▼ (Post-release step)

   1. depcirk-notify
   │
   │ (Sends repository_dispatch event)
   ▼
   [ Central Orchestrator Repository ]
   │
   ├──> 2. depcirk-crawler (Cron / Manual)
   │ └── Scans Org -> Updates dependency-map.json
   │
   └──> 3. depcirk-fanout (Triggered by dispatch event)
       └── Filters via Bun.semver -> Clones downstream -> Bun Update -> Creates PRs
```


## The Three Core Actions

### 1. `depcirk-notify`

A lightweight, isolated action embedded at the end of the release workflow (e.g., immediately following `npm publish` or `bunx semantic-release`) of every single individual repository in the organization.

* **Core Responsibility**: Act as an egress trigger to inform the central hub that a package has evolved. It remains entirely blind to the rest of the network topology.
* **Inputs**:
  * `github-token`: A GitHub PAT or App token with dispatch permissions.
  * `hub-repository`: The target central orchestrator repo (e.g., `tscircuit/depcirk-orchestrator`).
  * `package-name`: (Optional, infers from `package.json`).
  * `new-version`: (Optional, infers from release context).
* **Under the Hood**: Sends a fast authenticated HTTP POST request to the GitHub API, firing a `repository_dispatch` event of type `depcirk-package-released` containing the raw release metadata in the client payload.


### 2. `depcirk-crawler`

An internal infrastructure action executed solely inside the central orchestrator repository. It is responsible for mapping out the current layout of the entire network ecosystem.

* **Core Responsibility**: Scan the target GitHub organization, aggregate downstream dependency nodes, and commit an up-to-date topology matrix.
* **Execution Interval**: Typically triggered via a nightly GitHub Actions `cron` or executed manually via `workflow_dispatch`.
* **Inputs**:
  * `github-token`: GitHub App Installation Token / PAT with structural read access.
  * `target-org`: The organization to index (e.g., `tscircuit`).
* **Under the Hood**: Iterates through all public repositories in the designated organization, reads their primary `package.json` file, filters out matches, and commits a fresh, unified `dependency-map.json` back into the orchestrator repository's main branch.

### 3. `depcirk-fanout`

The heavy-lifter engine of the ecosystem. It is activated inside the orchestrator repository immediately whenever a `depcirk-package-released` event is captured by the repository ingress.

* **Core Responsibility**: Assess range implications, isolate downstream codebases, execute automated package bumps natively via `Bun`, and issue targeted PR requests.
* **Inputs**:
  * `github-token`: Core token with repository read/write and Pull Request creation permissions.
  * `package-name`: The incoming package identifier that triggered the process.
  * `new-version`: The newly minted target semver string.
  * `dependency-map-path`: Path to the compiled JSON map (defaults to `./dependency-map.json`).
* **Execution Algorithm**:
  1. **Evaluation**: Parses `dependency-map.json`. Feeds the package context into `Bun.semver` to evaluate target ranges. Determines which downstream targets need structural manifest adaptations or lockfile updates.
  2. **Isolate**: Iterates through the flagged downstream targets. For each target, it executes a clean clone into an isolated temporary running path.
  3. **Mutation**: Generates a dedicated branch (e.g., `depcirk/bump-{package_name}`). Invokes `bun change` or `bun update {package-name}@{new-version}`.
  4. **Publish**: Commits the mutations, pushes the branch back to the target component repository, and utilizes the GitHub API to launch a highly detailed, contextual Pull Request.


## Design Advantages & Constraints

### Why this approach works beautifully for Bun ecosystems:

* **Zero Configuration Proliferation**: Downstream repositories do not maintain any configuration matrices detailing how to consume upstream bumps. The update execution vector is strictly standardized: `bun install` -> `bun update` -> `git push` -> `gh pr create`.
* **Deterministic Sandbox Testing**: Sandboxing this pipeline does not require deploying GitHub Apps across production resources or setting up fake staging organizations. You can fully validate the engine using one central hub repo and 2-3 mock package repos under a personal GitHub profile simply by altering the `target-org` and `hub-repository` inputs.
* **Predictable Boundaries**: By intentionally limiting the runner scope to standard `bun/npm` actions, the codebase remains lean, clean, secure, and fully immune to execution environment discrepancies.


## Security & GitHub App Authorization Model

To prevent credential bloat, `depcirk` leverages the native asymmetric key capabilities of a standalone GitHub App:

1. **Private Key Generation**: The `depcirk` application creator generates and maintains the master `.pem` private key string.
2. **Frictionless Installation**: Target organizations (e.g., `tscircuit`) simply install the GitHub App onto their workspace via the web UI without managing localized private keys.
3. **Dynamic Token Exchange**: The `depcirk-fanout` and `depcirk-crawler` steps use the app's `App ID` and master `Private Key` stored in the orchestrator secrets to trade them dynamically for an ephemeral, time-bounded `Installation Access Token` scoped exactly to that organization's boundaries.
