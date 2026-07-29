// scripts/handle-release.ts
import fs from 'node:fs';
import { semver } from 'bun';

const ORG = 'tscircuit';
const TOKEN = process.env.GITHUB_TOKEN;
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const NEW_VERSION = process.env.NEW_VERSION;
const CALLER_REPO = process.env.CALLER_REPO;
const TRIGGERED_BY = process.env.TRIGGERED_BY;

if (!PACKAGE_NAME || !NEW_VERSION) {
  console.error('Error: PACKAGE_NAME and NEW_VERSION environment variables are required.');
  process.exit(1);
}

const HEADERS = {
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  'User-Agent': 'tscircuit-release-ingress'
};

// --- Explicit Type Definitions for Clarity ---
type PackageName = string; // e.g. "@tscircuit/core"
type RepoName = string;    // e.g. "core" (the actual GitHub repository name)

interface DependencyMap {
  [upstreamPackageName: PackageName]: RepoName[];
}

/**
 * Helper to retrieve downstream repository names for a given package.
 * Emphasizes that keys are Package Names and values are Repository Names.
 */
function getDownstreamRepositoryNames(
  dependencyMap: DependencyMap,
  targetPackage: PackageName
): RepoName[] {
  return dependencyMap[targetPackage] || [];
}

async function main() {
  console.log('========================================');
  console.log(`   Upstream Release Ingress Triggered   `);
  console.log('========================================');
  console.log(`Package Name:  ${PACKAGE_NAME}`);
  console.log(`New Version:   ${NEW_VERSION}`);
  console.log(`Caller Repo:   ${CALLER_REPO}`);
  console.log(`Triggered By:  ${TRIGGERED_BY}`);
  console.log('----------------------------------------\n');

  // 1. Load dependency map from Stage 1
  if (!fs.existsSync('dependency-map.json')) {
    console.error('Error: dependency-map.json not found. Run the crawler script first.');
    process.exit(1);
  }

  const dependencyMap: DependencyMap = JSON.parse(
    fs.readFileSync('dependency-map.json', 'utf-8')
  );

  // 2. Fetch downstream repository names using our helper function
  const downstreamRepos = getDownstreamRepositoryNames(dependencyMap, PACKAGE_NAME);
  console.log(`Found ${downstreamRepos.length} downstream repositories mapped to package '${PACKAGE_NAME}'.`);

  if (downstreamRepos.length === 0) {
    console.log('No downstream dependents found. Nothing to update.');
    return;
  }

  const reposNeedingManifestUpdate: RepoName[] = [];
  const reposNeedingLockfileUpdate: RepoName[] = [];

  // 3. Smart Semver Evaluation Loop
  for (const repoName of downstreamRepos) {
    const rawUrl = `https://raw.githubusercontent.com/${ORG}/${repoName}/main/package.json`;

    try {
      let res = await fetch(rawUrl, { headers: HEADERS });
      if (!res.ok) {
        const masterRes = await fetch(`https://raw.githubusercontent.com/${ORG}/${repoName}/master/package.json`, { headers: HEADERS });
        if (!masterRes.ok) {
          console.warn(`[Skip] Could not fetch package.json for repository '${repoName}'`);
          continue;
        }
        var pkg: any = await masterRes.json();
      } else {
        var pkg: any = await res.json();
      }

      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {})
      };

      const currentConstraint = allDeps[PACKAGE_NAME];

      if (!currentConstraint) {
        continue;
      }

      const isSatisfied = semver.satisfies(NEW_VERSION, currentConstraint);

      if (isSatisfied) {
        console.log(`[Satisfied] Repository '${repoName}' uses constraint '${currentConstraint}' (covers ${NEW_VERSION}) -> Lockfile refresh only`);
        reposNeedingLockfileUpdate.push(repoName);
      } else {
        console.log(`[Outdated]  Repository '${repoName}' uses constraint '${currentConstraint}' (does not cover ${NEW_VERSION}) -> Manifest update required`);
        reposNeedingManifestUpdate.push(repoName);
      }
    } catch (e: any) {
      console.warn(`[Error] Failed checking manifest for repository '${repoName}': ${e.message}`);
    }
  }

  console.log('\n==============================');
  console.log('      Ingress Analysis Summary     ');
  console.log('==============================');
  console.log(`Total Mapped Dependents:      ${downstreamRepos.length}`);
  console.log(`Needs Manifest Update:        ${reposNeedingManifestUpdate.length}`);
  console.log(`Needs Lockfile Refresh Only:  ${reposNeedingLockfileUpdate.length}`);
  console.log('------------------------------');
}

main().catch(err => {
  console.error('Release ingress failed:', err);
  process.exit(1);
});
