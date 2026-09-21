#!/usr/bin/env node

/**
 * Script to update GitHub / GitLab based dependencies in flake.nix.
 *
 * Supports pkgs.fetchFromGitHub and pkgs.fetchFromGitLab dependencies (like bpmn-auto-layout).
 * Resolves the target revision via git ls-remote and calculates the SRI hash via nix-prefetch-url.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Colors (respect NO_COLOR and TTY)
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const colors = {
    reset: useColor ? "\x1b[0m" : "",
    bold: useColor ? "\x1b[1m" : "",
    dim: useColor ? "\x1b[2m" : "",
    green: useColor ? "\x1b[32m" : "",
    yellow: useColor ? "\x1b[33m" : "",
    blue: useColor ? "\x1b[34m" : "",
    cyan: useColor ? "\x1b[36m" : "",
    red: useColor ? "\x1b[31m" : "",
};

export const FETCH_BLOCK_REGEX =
    /([a-zA-Z0-9_-]+)\s*=\s*(?:pkgs\.)?(fetchFromGitHub|fetchFromGitLab)\s*\{([\s\S]*?)\n\s*\};/g;

export function getAttr(body, attrName) {
    const match = body.match(new RegExp(`(?:^|\\n)\\s*${attrName}\\s*=\\s*"([^"]+)";`));
    return match ? match[1] : null;
}

export function parseDependencies(content) {
    const deps = [];
    const matches = [...content.matchAll(FETCH_BLOCK_REGEX)];

    for (const match of matches) {
        const [fullMatch, name, fetcherType, body] = match;
        const owner = getAttr(body, "owner");
        const repo = getAttr(body, "repo");
        const group = getAttr(body, "group");
        const domain = getAttr(body, "domain") || getAttr(body, "host");
        const rev = getAttr(body, "rev") || getAttr(body, "tag");
        const revAttr = body.includes("tag =") ? "tag" : "rev";
        const hash = getAttr(body, "hash") || getAttr(body, "sha256");
        const hashAttr = body.includes("sha256 =") ? "sha256" : "hash";

        if (!owner || !repo || !rev) {
            continue;
        }

        deps.push({
            name,
            type: fetcherType === "fetchFromGitHub" ? "github" : "gitlab",
            owner,
            repo,
            group,
            domain,
            rev,
            revAttr,
            hash,
            hashAttr,
            fullMatch,
            body,
            index: match.index,
        });
    }

    return deps;
}

export function getRepoUrl(dep) {
    if (dep.type === "github") {
        const domain = dep.domain || "github.com";
        return `https://${domain}/${dep.owner}/${dep.repo}.git`;
    }
    const domain = dep.domain || "gitlab.com";
    const slug = [dep.group, dep.owner, dep.repo].filter(Boolean).join("/");
    return `https://${domain}/${slug}.git`;
}

export function getArchiveUrl(dep, rev) {
    if (dep.type === "github") {
        const domain = dep.domain || "github.com";
        return `https://${domain}/${dep.owner}/${dep.repo}/archive/${rev}.tar.gz`;
    }
    const domain = dep.domain || "gitlab.com";
    const slug = [dep.group, dep.owner, dep.repo].filter(Boolean).join("/");
    const escapedSlug = slug.replace(/\./g, "%2E").replace(/\//g, "%2F");
    const escapedRev = encodeURIComponent(rev);
    return `https://${domain}/api/v4/projects/${escapedSlug}/repository/archive.tar.gz?sha=${escapedRev}`;
}

export function resolveRef(repoUrl, targetRef, runGit = defaultRunGit) {
    if (targetRef && /^[0-9a-fA-F]{40}$/.test(targetRef)) {
        return targetRef;
    }

    if (targetRef) {
        // Try branch
        const heads = runGit(["ls-remote", repoUrl, `refs/heads/${targetRef}`]);
        if (heads) {
            return heads.split(/\s+/)[0];
        }

        // Try tag (handle peeled ^{} if present)
        const tags = runGit([
            "ls-remote",
            repoUrl,
            `refs/tags/${targetRef}`,
            `refs/tags/${targetRef}^{}`,
        ]);
        if (tags) {
            const lines = tags
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
            const peeled = lines.find((l) => l.includes("^{}"));
            return (peeled || lines[0]).split(/\s+/)[0];
        }

        // Generic ref match
        const any = runGit(["ls-remote", repoUrl, targetRef]);
        if (any) {
            return any.split(/\s+/)[0];
        }

        throw new Error(`Could not resolve ref "${targetRef}" on ${repoUrl}`);
    }

    // Default: remote HEAD
    const head = runGit(["ls-remote", repoUrl, "HEAD"]);
    if (head) {
        return head.split(/\s+/)[0];
    }

    // Fallback: main then master
    const main = runGit(["ls-remote", repoUrl, "refs/heads/main"]);
    if (main) {
        return main.split(/\s+/)[0];
    }
    const master = runGit(["ls-remote", repoUrl, "refs/heads/master"]);
    if (master) {
        return master.split(/\s+/)[0];
    }

    throw new Error(`Could not determine default HEAD on ${repoUrl}`);
}

export function computeSriHash(archiveUrl, runCommand = execFileSync) {
    const rawOutput = runCommand("nix-prefetch-url", ["--unpack", archiveUrl], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const rawHash = rawOutput.split("\n").pop().trim();
    if (!rawHash) {
        throw new Error(`nix-prefetch-url did not return a hash for ${archiveUrl}`);
    }

    try {
        return runCommand(
            "nix",
            ["hash", "convert", "--to", "sri", "--hash-algo", "sha256", rawHash],
            {
                encoding: "utf8",
                stdio: ["pipe", "pipe", "pipe"],
            },
        ).trim();
    } catch {
        return runCommand("nix", ["hash", "to-sri", "--type", "sha256", rawHash], {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
    }
}

export function updateBlockBody(body, { revAttr, newRev, hashAttr, newHash }) {
    let updated = body;
    updated = updated.replace(
        new RegExp(`((?:^|\\n)\\s*${revAttr}\\s*=\\s*)"[^"]+";`),
        `$1"${newRev}";`,
    );
    if (newHash) {
        updated = updated.replace(
            new RegExp(`((?:^|\\n)\\s*${hashAttr}\\s*=\\s*)"[^"]+";`),
            `$1"${newHash}";`,
        );
    }
    return updated;
}

export function matchesTarget(dep, target) {
    if (!target) return true;
    const lowerTarget = target.toLowerCase();
    return Boolean(
        dep.name.toLowerCase() === lowerTarget ||
        dep.repo.toLowerCase() === lowerTarget ||
        `${dep.owner}/${dep.repo}`.toLowerCase() === lowerTarget ||
        (dep.group && `${dep.group}/${dep.owner}/${dep.repo}`.toLowerCase() === lowerTarget),
    );
}

function defaultRunGit(args) {
    return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
    }).trim();
}

function checkRequiredTools() {
    const missing = [];
    for (const tool of ["git", "nix-prefetch-url", "nix"]) {
        try {
            execFileSync("which", [tool], { stdio: "ignore" });
        } catch {
            missing.push(tool);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `Missing required command(s): ${missing.join(", ")}.\n` +
                `Please ensure they are installed or run within devenv or nix develop.`,
        );
    }
}

function printUsage() {
    console.log(`
${colors.bold}Usage:${colors.reset} ./scripts/update-flake-deps.sh [OPTIONS] [DEPENDENCY] [REV]

Update GitHub / GitLab based dependencies in flake.nix (pkgs.fetchFromGitHub / pkgs.fetchFromGitLab).

${colors.bold}Arguments:${colors.reset}
  DEPENDENCY         Optional dependency filter (e.g. 'autoLayoutSource', 'bpmn-auto-layout', or 'datakurre/bpmn-auto-layout')
  REV                Optional target branch, tag, or commit hash (defaults to remote HEAD)

${colors.bold}Options:${colors.reset}
  -f, --flake FILE   Path to flake.nix (default: ./flake.nix)
  -r, --rev REV      Target git revision (branch, tag, or commit SHA)
  -n, --dry-run      Preview changes without modifying flake.nix
  --force            Recompute hash and update even if revision has not changed
  -q, --quiet        Suppress non-essential progress output
  -h, --help         Show this help message

${colors.bold}Examples:${colors.reset}
  # Update all GitHub / GitLab dependencies to their latest remote HEAD
  ./scripts/update-flake-deps.sh

  # Update only bpmn-auto-layout to latest remote HEAD
  ./scripts/update-flake-deps.sh bpmn-auto-layout

  # Update bpmn-auto-layout to a specific commit or branch
  ./scripts/update-flake-deps.sh bpmn-auto-layout main
  ./scripts/update-flake-deps.sh autoLayoutSource 937dca2ca782eb4b57df82595002ac5759bcb516

  # Preview updates without writing to flake.nix
  ./scripts/update-flake-deps.sh --dry-run
`);
}

export async function main(argv = process.argv.slice(2)) {
    let flakePath = "./flake.nix";
    let targetDep = null;
    let targetRev = null;
    let dryRun = false;
    let force = false;
    let quiet = false;

    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "-h" || arg === "--help") {
            printUsage();
            return 0;
        } else if (arg === "-n" || arg === "--dry-run") {
            dryRun = true;
        } else if (arg === "--force") {
            force = true;
        } else if (arg === "-q" || arg === "--quiet") {
            quiet = true;
        } else if (arg === "-f" || arg === "--flake") {
            flakePath = argv[++i];
        } else if (arg === "-r" || arg === "--rev") {
            targetRev = argv[++i];
        } else if (!arg.startsWith("-")) {
            positional.push(arg);
        } else {
            console.error(`${colors.red}Error: Unknown option '${arg}'${colors.reset}`);
            printUsage();
            return 1;
        }
    }

    if (positional.length > 0) {
        targetDep = positional[0];
    }
    if (positional.length > 1 && !targetRev) {
        targetRev = positional[1];
    }

    const resolvedFlakePath = path.resolve(process.cwd(), flakePath);
    if (!fs.existsSync(resolvedFlakePath)) {
        console.error(`${colors.red}Error: File not found: ${resolvedFlakePath}${colors.reset}`);
        return 1;
    }

    checkRequiredTools();

    const originalContent = fs.readFileSync(resolvedFlakePath, "utf8");
    const allDeps = parseDependencies(originalContent);

    if (allDeps.length === 0) {
        if (!quiet) {
            console.log(
                `${colors.yellow}No GitHub/GitLab dependencies found in ${flakePath}.${colors.reset}`,
            );
        }
        return 0;
    }

    const matchedDeps = allDeps.filter((dep) => matchesTarget(dep, targetDep));
    if (matchedDeps.length === 0) {
        console.error(`${colors.red}Error: No dependency matched '${targetDep}'.${colors.reset}`);
        console.log(`Available dependencies:`);
        for (const dep of allDeps) {
            console.log(
                `  - ${colors.cyan}${dep.name}${colors.reset} (${dep.type}: ${dep.owner}/${dep.repo})`,
            );
        }
        return 1;
    }

    if (!quiet) {
        console.log(
            `${colors.bold}Checking ${matchedDeps.length} dependenc${matchedDeps.length === 1 ? "y" : "ies"} in ${flakePath}...${colors.reset}`,
        );
    }

    let updatedContent = originalContent;
    let updatedCount = 0;

    for (const dep of matchedDeps) {
        const repoUrl = getRepoUrl(dep);
        if (!quiet) {
            process.stdout.write(
                `Checking ${colors.cyan}${dep.name}${colors.reset} (${dep.owner}/${dep.repo} from ${dep.type})... `,
            );
        }

        let newRev;
        try {
            newRev = resolveRef(repoUrl, targetRev);
        } catch (err) {
            if (!quiet) process.stdout.write("\n");
            console.error(
                `${colors.red}Failed to resolve revision for ${dep.name}: ${err.message}${colors.reset}`,
            );
            return 1;
        }

        const isRevChanged = dep.rev !== newRev;
        if (!isRevChanged && !force) {
            if (!quiet) {
                console.log(`${colors.green}✓ up to date${colors.reset} (${dep.rev.slice(0, 7)})`);
            }
            continue;
        }

        if (!quiet) {
            console.log(`${colors.yellow}updating${colors.reset}`);
            console.log(`  Target rev:  ${dep.rev} -> ${colors.bold}${newRev}${colors.reset}`);
        }

        const archiveUrl = getArchiveUrl(dep, newRev);
        if (!quiet) {
            process.stdout.write(`  Prefetching archive... `);
        }

        let newHash;
        try {
            newHash = computeSriHash(archiveUrl);
            if (!quiet) {
                console.log(`${colors.green}done${colors.reset}`);
                console.log(
                    `  Hash:        ${dep.hash} -> ${colors.bold}${newHash}${colors.reset}`,
                );
            }
        } catch (err) {
            if (!quiet) process.stdout.write("\n");
            console.error(
                `${colors.red}Failed to compute hash for ${archiveUrl}: ${err.message}${colors.reset}`,
            );
            return 1;
        }

        const newBody = updateBlockBody(dep.body, {
            revAttr: dep.revAttr,
            newRev,
            hashAttr: dep.hashAttr,
            newHash,
        });

        const newFullMatch = dep.fullMatch.replace(dep.body, newBody);
        updatedContent = updatedContent.replace(dep.fullMatch, newFullMatch);
        updatedCount++;
    }

    if (updatedCount > 0) {
        if (dryRun) {
            console.log(
                `\n${colors.yellow}[dry-run] ${updatedCount} dependenc${updatedCount === 1 ? "y" : "ies"} would be updated in ${flakePath}.${colors.reset}`,
            );
        } else {
            fs.writeFileSync(resolvedFlakePath, updatedContent, "utf8");
            console.log(
                `\n${colors.green}✓ Successfully updated ${updatedCount} dependenc${updatedCount === 1 ? "y" : "ies"} in ${flakePath}.${colors.reset}`,
            );
        }
    } else {
        if (!quiet) {
            console.log(
                `\n${colors.green}All matching dependencies are already up to date.${colors.reset}`,
            );
        }
    }

    return 0;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().then((code) => {
        if (code !== 0) {
            process.exit(code);
        }
    });
}
