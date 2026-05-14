import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBwrapSetup, buildSandboxExecProfile } from "./providers.ts";
import type { SandboxConfig } from "./types.ts";

describe("buildSandboxExecProfile", () => {
  it("adds denyRead rules to the sandbox-exec profile", () => {
    const config: SandboxConfig = {
      enabled: true,
      denyRead: ["/etc/passwd", "/Users/test/.ssh"],
      writable: ["/workspace"],
      denyWithin: ["/workspace/.git/hooks"],
      network: true,
    };

    const profile = buildSandboxExecProfile(config);

    assert.match(profile, /\(deny file-read\* \(literal "\/etc\/passwd"\)\)/);
    assert.match(profile, /\(deny file-read\* \(subpath "\/etc\/passwd"\)\)/);
    assert.match(profile, /\(deny file-read\* \(literal "\/Users\/test\/\.ssh"\)\)/);
  });
});

describe("buildBwrapSetup", () => {
  it("overlays denyRead files and directories after normal binds", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pi-sandbox-workspace-"));
    const secretDir = mkdtempSync(join(tmpdir(), "pi-sandbox-secret-dir-"));
    try {
      const secretFile = join(workspace, "secret.txt");
      writeFileSync(secretFile, "secret");
      mkdirSync(join(secretDir, "nested"));

      const config: SandboxConfig = {
        enabled: true,
        denyRead: [secretFile, secretDir],
        writable: [workspace],
        denyWithin: [],
        network: true,
      };

      const setup = buildBwrapSetup(workspace, config, workspace);
      try {
        assert.notEqual(setup.args[0], "bwrap");
        const fileOverlayIndex = setup.args.findIndex(
          (_arg, index) =>
            setup.args[index] === "--ro-bind" &&
            setup.args[index + 2] === secretFile,
        );
        const dirOverlayIndex = setup.args.findIndex(
          (_arg, index) =>
            setup.args[index] === "--ro-bind" &&
            setup.args[index + 2] === secretDir,
        );

        assert.notEqual(fileOverlayIndex, -1);
        assert.notEqual(dirOverlayIndex, -1);
        const fileOverlaySource = setup.args[fileOverlayIndex + 1];
        const dirOverlaySource = setup.args[dirOverlayIndex + 1];
        assert.equal(statSync(fileOverlaySource).mode & 0o777, 0);
        assert.equal(statSync(dirOverlaySource).mode & 0o777, 0);
        assert.throws(() => readFileSync(fileOverlaySource, "utf8"));
        assert.throws(() => readdirSync(dirOverlaySource));
        assert.equal(setup.args.includes("--chdir"), true);
        assert.equal(setup.args.includes("--"), false);
      } finally {
        setup.cleanup();
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(secretDir, { recursive: true, force: true });
    }
  });
});
