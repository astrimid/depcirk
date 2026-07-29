# Current Proof of Concept (POC) Overview & Next Steps

## What Has Been Built So Far

1. **The Dependency Graph Crawler (`scripts/update-graph.ts`):** Automatically traverses public/private repos in the organization, reads `package.json` files via CDN, and builds `dependency-map.json`.
2. **The Ingress Workflow (`.github/workflows/handle-release.yml`):** Configured with explicit inputs, safe defaults for UI testing (`workflow_dispatch`), and automated propagation (`workflow_call`).
3. **The Release Handler Script (`scripts/handle-release.ts`):**
* Loads the dependency map and resolves downstream repository names.
* Injects Bun's native semver engine to evaluate whether the new version is already satisfied.
* Categorizes dependents into **Manifest Updates** vs. **Lockfile/Satisfied Refreshes**.



## Immediate Next Steps for the POC

To turn this working analysis engine into an active POC that performs real work, the remaining steps are:

1. **Implement the Action Execution Mechanism (Choose A or B):**
* *Option A (Dispatch):* Have the script send a `repository_dispatch` event to each queued repository.
* *Option B (Direct PR):* Use a GitHub App / PAT token inside the central script to directly branch, update `package.json`, and open a Pull Request on the target repository.


2. **Add a Simple Output / Logging Hook:** Print out the exact git commands or API calls that *would* be executed for each target repo during dry-runs.

3. **Test End-to-End:** Trigger the workflow manually via `workflow_dispatch` on a test package and verify that the filter correctly identifies the downstream repositories.
