import { describe, it, expect, vi } from "vitest";
import {
    parseDependencies,
    getRepoUrl,
    getArchiveUrl,
    matchesTarget,
    updateBlockBody,
    resolveRef,
    computeSriHash,
} from "./update-flake-deps.mjs";

describe("update-flake-deps", () => {
    const sampleFlake = `
{
  outputs = { self, nixpkgs }: {
    packages = forAllSystems (pkgs: {
      autoLayoutSource = pkgs.fetchFromGitHub {
        owner = "datakurre";
        repo = "bpmn-auto-layout";
        rev = "22fdc50b1c80969090b68c8322add031d3cbc4af";
        hash = "sha256-3xPW/qgJDchwlip1PpsgHrDIyGBiBPakPoWouVnBM50=";
      };

      elementTemplatesSource = pkgs.fetchFromGitLab {
        owner = "vasara-bpm";
        repo = "operaton-element-templates";
        rev = "ed8d91e5a859dc1470426ce5e09ddf4b4666aecb";
        hash = "sha256-+YpaXqA7usqbLrr7AlG/1opxAFTwuBW6t7I56xv5u0g=";
      };

      customGitLabSource = fetchFromGitLab {
        domain = "gitlab.example.org";
        group = "my-group";
        owner = "my-subgroup";
        repo = "my-repo";
        tag = "v1.0.0";
        sha256 = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      };
    });
  };
}
`;

    describe("parseDependencies", () => {
        it("should parse fetchFromGitHub and fetchFromGitLab blocks", () => {
            const deps = parseDependencies(sampleFlake);
            expect(deps).toHaveLength(3);

            expect(deps[0]).toMatchObject({
                name: "autoLayoutSource",
                type: "github",
                owner: "datakurre",
                repo: "bpmn-auto-layout",
                rev: "22fdc50b1c80969090b68c8322add031d3cbc4af",
                revAttr: "rev",
                hash: "sha256-3xPW/qgJDchwlip1PpsgHrDIyGBiBPakPoWouVnBM50=",
                hashAttr: "hash",
            });

            expect(deps[1]).toMatchObject({
                name: "elementTemplatesSource",
                type: "gitlab",
                owner: "vasara-bpm",
                repo: "operaton-element-templates",
                rev: "ed8d91e5a859dc1470426ce5e09ddf4b4666aecb",
                revAttr: "rev",
                hash: "sha256-+YpaXqA7usqbLrr7AlG/1opxAFTwuBW6t7I56xv5u0g=",
                hashAttr: "hash",
            });

            expect(deps[2]).toMatchObject({
                name: "customGitLabSource",
                type: "gitlab",
                domain: "gitlab.example.org",
                group: "my-group",
                owner: "my-subgroup",
                repo: "my-repo",
                rev: "v1.0.0",
                revAttr: "tag",
                hash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                hashAttr: "sha256",
            });
        });
    });

    describe("getRepoUrl", () => {
        it("should construct GitHub clone URL", () => {
            const dep = { type: "github", owner: "datakurre", repo: "bpmn-auto-layout" };
            expect(getRepoUrl(dep)).toBe("https://github.com/datakurre/bpmn-auto-layout.git");
        });

        it("should construct GitLab clone URL with owner", () => {
            const dep = { type: "gitlab", owner: "vasara-bpm", repo: "operaton-element-templates" };
            expect(getRepoUrl(dep)).toBe(
                "https://gitlab.com/vasara-bpm/operaton-element-templates.git",
            );
        });

        it("should construct GitLab clone URL with group and custom domain", () => {
            const dep = {
                type: "gitlab",
                domain: "gitlab.example.org",
                group: "my-group",
                owner: "my-subgroup",
                repo: "my-repo",
            };
            expect(getRepoUrl(dep)).toBe(
                "https://gitlab.example.org/my-group/my-subgroup/my-repo.git",
            );
        });
    });

    describe("getArchiveUrl", () => {
        it("should construct GitHub archive URL", () => {
            const dep = { type: "github", owner: "datakurre", repo: "bpmn-auto-layout" };
            expect(getArchiveUrl(dep, "937dca2ca782eb4b57df82595002ac5759bcb516")).toBe(
                "https://github.com/datakurre/bpmn-auto-layout/archive/937dca2ca782eb4b57df82595002ac5759bcb516.tar.gz",
            );
        });

        it("should construct GitLab archive URL with URL-encoded slug", () => {
            const dep = { type: "gitlab", owner: "vasara-bpm", repo: "operaton-element-templates" };
            expect(getArchiveUrl(dep, "ed8d91e5a859dc1470426ce5e09ddf4b4666aecb")).toBe(
                "https://gitlab.com/api/v4/projects/vasara-bpm%2Foperaton-element-templates/repository/archive.tar.gz?sha=ed8d91e5a859dc1470426ce5e09ddf4b4666aecb",
            );
        });
    });

    describe("matchesTarget", () => {
        const dep = { name: "autoLayoutSource", owner: "datakurre", repo: "bpmn-auto-layout" };

        it("should match by variable name", () => {
            expect(matchesTarget(dep, "autoLayoutSource")).toBe(true);
            expect(matchesTarget(dep, "autolayoutsource")).toBe(true);
        });

        it("should match by repository name", () => {
            expect(matchesTarget(dep, "bpmn-auto-layout")).toBe(true);
        });

        it("should match by owner/repo", () => {
            expect(matchesTarget(dep, "datakurre/bpmn-auto-layout")).toBe(true);
        });

        it("should return false for non-matching target", () => {
            expect(matchesTarget(dep, "something-else")).toBe(false);
        });

        it("should return true when target is null/undefined", () => {
            expect(matchesTarget(dep, null)).toBe(true);
            expect(matchesTarget(dep, undefined)).toBe(true);
        });
    });

    describe("updateBlockBody", () => {
        it("should update rev and hash while preserving indentation", () => {
            const body = `
          owner = "datakurre";
          repo = "bpmn-auto-layout";
          rev = "old-rev";
          hash = "old-hash";`;

            const updated = updateBlockBody(body, {
                revAttr: "rev",
                newRev: "new-rev-12345",
                hashAttr: "hash",
                newHash: "sha256-new-hash",
            });

            expect(updated).toBe(`
          owner = "datakurre";
          repo = "bpmn-auto-layout";
          rev = "new-rev-12345";
          hash = "sha256-new-hash";`);
        });

        it("should update tag and sha256 when configured", () => {
            const body = `
          owner = "org";
          repo = "repo";
          tag = "v1.0.0";
          sha256 = "sha256-old";`;

            const updated = updateBlockBody(body, {
                revAttr: "tag",
                newRev: "v2.0.0",
                hashAttr: "sha256",
                newHash: "sha256-new",
            });

            expect(updated).toBe(`
          owner = "org";
          repo = "repo";
          tag = "v2.0.0";
          sha256 = "sha256-new";`);
        });
    });

    describe("resolveRef", () => {
        it("should return 40-character SHA directly without running git", () => {
            const sha = "937dca2ca782eb4b57df82595002ac5759bcb516";
            const mockGit = vi.fn();
            expect(resolveRef("https://example.com/repo.git", sha, mockGit)).toBe(sha);
            expect(mockGit).not.toHaveBeenCalled();
        });

        it("should resolve HEAD from git ls-remote when no targetRef specified", () => {
            const mockGit = vi
                .fn()
                .mockReturnValue("937dca2ca782eb4b57df82595002ac5759bcb516\tHEAD\n");
            const result = resolveRef("https://example.com/repo.git", null, mockGit);
            expect(result).toBe("937dca2ca782eb4b57df82595002ac5759bcb516");
            expect(mockGit).toHaveBeenCalledWith([
                "ls-remote",
                "https://example.com/repo.git",
                "HEAD",
            ]);
        });

        it("should resolve branch ref when specified", () => {
            const mockGit = vi.fn((args: string[]) => {
                if (args.includes("refs/heads/main")) {
                    return "1111111111111111111111111111111111111111\trefs/heads/main\n";
                }
                return "";
            });
            const result = resolveRef("https://example.com/repo.git", "main", mockGit);
            expect(result).toBe("1111111111111111111111111111111111111111");
        });

        it("should resolve peeled tag ref when tag is specified", () => {
            const mockGit = vi.fn((args: string[]) => {
                if (args.includes("refs/heads/v1.0")) {
                    return "";
                }
                if (args.includes("refs/tags/v1.0")) {
                    return (
                        "tag-sha-1111\trefs/tags/v1.0\n" + "commit-sha-2222\trefs/tags/v1.0^{}\n"
                    );
                }
                return "";
            });
            const result = resolveRef("https://example.com/repo.git", "v1.0", mockGit);
            expect(result).toBe("commit-sha-2222");
        });
    });

    describe("computeSriHash", () => {
        it("should parse prefetch output and convert to sri", () => {
            const mockRunner = vi.fn((cmd: string, args: string[]) => {
                if (cmd === "nix-prefetch-url") {
                    return "path is /nix/store/...\n1qkaaxjy85is31qp665nqb8ndpny2qyfn3p1v3nbrycqba8nlipr\n";
                }
                if (cmd === "nix" && args.includes("convert")) {
                    return "sha256-+UZqkVqY+bzs2OEO6zwW3t5m0cK2GHNxGDoW5GVXauI=\n";
                }
                return "";
            });

            const result = computeSriHash("https://example.com/archive.tar.gz", mockRunner as any);
            expect(result).toBe("sha256-+UZqkVqY+bzs2OEO6zwW3t5m0cK2GHNxGDoW5GVXauI=");
            expect(mockRunner).toHaveBeenCalledWith(
                "nix-prefetch-url",
                ["--unpack", "https://example.com/archive.tar.gz"],
                expect.any(Object),
            );
        });
    });
});
