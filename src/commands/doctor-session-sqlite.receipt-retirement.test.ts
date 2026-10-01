import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadExactSessionEntry } from "../config/sessions/session-accessor.sqlite-entry.js";
import { loadTranscriptEventsSync } from "../config/sessions/session-accessor.sqlite-read.js";
import {
  readDeferredPluginMigrations,
  recordDeferredPluginMigrations,
} from "../infra/deferred-plugin-migrations.js";
import {
  hasDeferredPluginSessionImport,
  readDeferredPluginSessionImport,
} from "../infra/deferred-plugin-session-sources.js";
import * as directoryDurability from "../infra/directory-durability.js";
import * as migrationRun from "../infra/session-sqlite-migration-manifest.js";
import { runOpenClawStateWriteTransaction } from "../state/openclaw-state-db.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  editAndDeleteImportedSessions,
  seedDeferredPluginSessionSource,
} from "./doctor-session-sqlite.deferred-plugin.test-support.js";
import { runDoctorSessionSqlite } from "./doctor-session-sqlite.js";

afterEach(() => vi.restoreAllMocks());

type SessionScope = Awaited<ReturnType<typeof seedDeferredPluginSessionSource>>["scope"];

function expectCanonicalSessions(scope: SessionScope, label: string) {
  expect(loadExactSessionEntry({ ...scope, sessionKey: "agent:main:kept" })?.entry.label).toBe(
    label,
  );
  expect(loadExactSessionEntry({ ...scope, sessionKey: "agent:main:deleted" })).toBeUndefined();
}

describe("deferred plugin session receipt retirement", () => {
  it("preserves canonical edits when an indexless receipt meets a recreated legacy index", async () => {
    await withOpenClawTestState({ label: "deferred-recreated-index" }, async (state) => {
      const { cfg, storePath, scope, originals } = await seedDeferredPluginSessionSource(
        state,
        "default",
      );
      const run = () =>
        runDoctorSessionSqlite({ cfg, env: state.env, allAgents: true, mode: "import" });
      const imported = await run();
      const target = imported.targets[0]!;
      const receipt = readDeferredPluginSessionImport({
        cfg,
        env: state.env,
        target,
        sqlitePath: target.sqlitePath,
      })!;
      await editAndDeleteImportedSessions(scope, "current SQLite metadata");
      await recordDeferredPluginMigrations({
        env: state.env,
        pending: [],
        resolvedPluginIds: ["fixture-plugin"],
      });
      await run();
      expect(fs.existsSync(storePath)).toBe(false);
      // Older indexless receipts can outlive archival; a later index is unverified input.
      runOpenClawStateWriteTransaction(
        ({ db }) => {
          db.prepare(
            "UPDATE migration_sources SET removed_source = 0, report_json = ? WHERE migration_kind = 'deferred-plugin-session-import'",
          ).run(
            JSON.stringify({
              ...receipt,
              sources: receipt.sources.filter((source) => source.path !== storePath),
            }),
          );
        },
        { env: state.env },
      );
      fs.writeFileSync(storePath, originals.get(storePath)!);

      const publish = directoryDurability.publishFileExclusive;
      const publication = vi
        .spyOn(directoryDurability, "publishFileExclusive")
        .mockImplementation(async (options) => {
          if (options.sourcePath === storePath) {
            throw new Error("fixture recreated-index publication interrupted");
          }
          return publish(options);
        });
      await run();
      publication.mockRestore();
      expect(fs.readFileSync(storePath)).toEqual(originals.get(storePath));
      expect(
        hasDeferredPluginSessionImport({ target, sqlitePath: target.sqlitePath, env: state.env }),
      ).toBe(true);
      expectCanonicalSessions(scope, "current SQLite metadata");

      const repaired = await run();
      expect(repaired.totals.importedEntries).toBe(0);
      expect(repaired.targets.flatMap((entry) => entry.issues)).toContainEqual(
        expect.objectContaining({ code: "retained_plugin_source_conflict" }),
      );
      expectCanonicalSessions(scope, "current SQLite metadata");
      const manifest = migrationRun.readSessionSqliteMigrationManifest(
        repaired.migrationRun!.manifestPath,
      )!;
      const archivedIndex = manifest.targets
        .flatMap((entry) => entry.completedMoves)
        .find((move) => move.sourcePath === storePath)!;
      expect(archivedIndex.artifact?.classification).toBe("protected");
      expect(fs.readFileSync(archivedIndex.archivePath)).toEqual(originals.get(storePath));
      await run();
      expectCanonicalSessions(scope, "current SQLite metadata");
    });
  });

  it.each(["completed", "disabled", "uninstalled", "globally-disabled"] as const)(
    "retires a %s plugin's receipt and imports later history without replaying old sessions",
    async (completion) => {
      await withOpenClawTestState({ label: "deferred-plugin-receipt-lifecycle" }, async (state) => {
        const { cfg, storePath, scope } = await seedDeferredPluginSessionSource(state, "default");
        const run = () =>
          runDoctorSessionSqlite({ cfg, env: state.env, allAgents: true, mode: "import" });
        const imported = await run();
        const target = imported.targets[0]!;
        const receipt = () =>
          readDeferredPluginSessionImport({
            cfg,
            env: state.env,
            target,
            sqlitePath: target.sqlitePath,
          });
        expect(receipt()).toBeDefined();
        await editAndDeleteImportedSessions(scope, "current SQLite metadata");
        const transcript = path.join(path.dirname(storePath), "new-history.jsonl");
        const contents =
          [
            { type: "session", version: 3, id: "new-history" },
            {
              type: "message",
              id: "new-message",
              parentId: null,
              message: { role: "user", content: "new history" },
            },
          ]
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n";
        fs.writeFileSync(transcript, contents);
        const pending = await run();
        expect(pending.totals.importedEntries).toBe(0);
        expect(pending.targets.flatMap((entry) => entry.issues)).toContainEqual(
          expect.objectContaining({
            code: "plugin_migration_source_retained",
            message: expect.stringContaining("deferred-plugin-session-import"),
          }),
        );
        expect(fs.readFileSync(transcript, "utf8")).toBe(contents);
        if (completion === "completed") {
          await recordDeferredPluginMigrations({
            env: state.env,
            pending: [],
            resolvedPluginIds: ["fixture-plugin"],
          });
        } else {
          // Uninstall persists the same explicit disable marker after removing its package.
          cfg.plugins = {
            ...(completion === "globally-disabled"
              ? { enabled: false }
              : { entries: { "fixture-plugin": { enabled: false } } }),
            ...(completion === "disabled"
              ? {
                  installs: {
                    "fixture-plugin": { source: "npm", spec: "@example/fixture-plugin" },
                  },
                }
              : {}),
          };
        }
        await run();
        expect(readDeferredPluginMigrations({ env: state.env })).toEqual([]);
        expect(receipt()).toBeUndefined();
        expect(fs.readFileSync(transcript, "utf8")).toBe(contents);
        if (completion === "completed") {
          // Published versions left archived receipts active indefinitely.
          runOpenClawStateWriteTransaction(
            ({ db }) => {
              db.prepare(
                "UPDATE migration_sources SET removed_source = 0 WHERE migration_kind = 'deferred-plugin-session-import'",
              ).run();
            },
            { env: state.env },
          );
          expect(receipt()).toBeDefined();
        }
        const later = await run();
        expect(later.totals.importedEntries).toBe(1);
        expect(later.totals.importedTranscriptEvents).toBe(2);
        expect(loadTranscriptEventsSync({ ...scope, sessionId: "new-history" })).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "new-message" })]),
        );
        expectCanonicalSessions(scope, "current SQLite metadata");
        expect(receipt()).toBeUndefined();
      });
    },
  );
});
