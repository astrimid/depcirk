import fs from 'node:fs';

const ORG = 'tscircuit';
const TOKEN = process.env.GITHUB_TOKEN;

const HEADERS = {
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  'User-Agent': 'tscircuit-dependency-crawler'
};

interface GithubRepo {
  name: string;
  default_branch: string;
  archived: boolean;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

type DependencyMap = Record<string, string[]>;

// Progress bar helper with custom CI cadence (First, every 10, and Last)
class ProgressBar {
  private total: number;
  private width: number;
  private isTTY: boolean;

  constructor(total: number, width = 25) {
    this.total = total;
    this.width = width;
    this.isTTY = !!process.stdout.isTTY;
  }

  update(current: number, label: string) {
    const percent = Math.min(Math.max(current / this.total, 0), 1);
    const filled = Math.round(this.width * percent);
    const empty = this.width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percentage = Math.floor(percent * 100);

    if (this.isTTY) {
      // Local terminal: smooth inline animated bar
      process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${this.total}) | ${label}`);
      if (current === this.total) {
        process.stdout.write('\n');
      }
    } else {
      // CI environment: log on first item, every 10 items, and the final item
      if (current === 1 || current % 10 === 0 || current === this.total) {
        console.log(`[CI Progress] ${percentage}% (${current}/${this.total}) - ${label}`);
      }
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function main() {
  console.log(`Crawling repositories for organization: ${ORG}...`);
  
  let repos: GithubRepo[] = [];
  let page = 1;
  
  // 1. Paginate through all repositories
  while (true) {
    const data = await fetchJson<GithubRepo[]>(
      `https://api.github.com/orgs/${ORG}/repos?per_page=100&page=${page}`
    );
    if (data.length === 0) break;
    repos.push(...data);
    page++;
  }

  console.log(`Found ${repos.length} total repositories. Scanning manifests...\n`);

  const dependencyMap: DependencyMap = {};
  const progress = new ProgressBar(repos.length);

  let parsedCount = 0;
  let skippedArchived = 0;
  let skippedNoPackageJson = 0;
  let skippedErrors = 0;
  let currentProcessed = 0;

  // 2. Scan each repository's package.json
  for (const repo of repos) {
    currentProcessed++;

    if (repo.archived) {
      skippedArchived++;
      progress.update(currentProcessed, `Skipped (Archived): ${repo.name}`);
      continue;
    }

    const rawUrl = `https://raw.githubusercontent.com/${ORG}/${repo.name}/${repo.default_branch}/package.json`;
    
    try {
      const pkgRes = await fetch(rawUrl, { 
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} 
      });
      
      if (!pkgRes.ok) {
        skippedNoPackageJson++;
        progress.update(currentProcessed, `No package.json: ${repo.name}`);
        continue;
      }
      
      const pkg = (await pkgRes.json()) as PackageJson;
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {})
      };

      // 3. Map internal dependencies back to the consuming repository
      for (const depName of Object.keys(allDeps)) {
        if (depName.startsWith('@tscircuit/')) {
          if (!dependencyMap[depName]) {
            dependencyMap[depName] = [];
          }
          if (!dependencyMap[depName].includes(repo.name)) {
            dependencyMap[depName].push(repo.name);
          }
        }
      }
      parsedCount++;
      progress.update(currentProcessed, `Parsed: ${repo.name}`);
    } catch (e: any) {
      skippedErrors++;
      progress.update(currentProcessed, `Error: ${repo.name}`);
    }
  }

  // 4. Save the generated map locally
  fs.writeFileSync('dependency-map.json', JSON.stringify(dependencyMap, null, 2));

  // 5. Print out clean summary breakdown
  console.log('\n==============================');
  console.log('   Crawler Summary Report     ');
  console.log('==============================');
  console.log(`Total Repositories Found:       ${repos.length}`);
  console.log(`Successfully Parsed:            ${parsedCount}`);
  console.log(`Skipped (Archived):             ${skippedArchived}`);
  console.log(`Skipped (No package.json):      ${skippedNoPackageJson}`);
  console.log(`Skipped (Errors / Malformed):   ${skippedErrors}`);
  console.log('------------------------------');
  console.log('Success! dependency-map.json updated.');
}

main().catch(err => {
  console.error('\nCrawler failed:', err);
  process.exit(1);
});
