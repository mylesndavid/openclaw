import { isDeepStrictEqual } from "node:util";
import { runOpenClawStateWriteTransaction } from "../state/openclaw-state-db.js";
import {
  readDeferredPluginMigrations,
  withDeferredPluginMigrationsCurrent,
} from "./deferred-plugin-migrations.js";
import {
  DeferredPluginSessionImportSchema,
  readDeferredPluginSessionImport,
  readDeferredPluginSessionImportReceipt,
  type SessionImportSource,
} from "./deferred-plugin-session-sources.js";
import { statMigrationPath } from "./session-sqlite-migration-artifact.js";
import { markLegacyMigrationSourceRemovedInDatabase } from "./state-migrations.receipts.js";

/** Archival, not plugin completion alone, ends the original index's no-replay obligation. */
export function retireDeferredPluginSessionImport(
  params: SessionImportSource & {
    completedPluginIds?: readonly string[];
    assertCurrent?: () => void;
  },
): void {
  const receipt = readDeferredPluginSessionImportReceipt(params);
  if (!receipt) {
    return;
  }
  const recorded = DeferredPluginSessionImportSchema.parse(JSON.parse(receipt.reportJson));
  const expectedPending = readDeferredPluginMigrations({ env: params.env });
  if (
    expectedPending.some(
      (pending) =>
        recorded.pluginIds.includes(pending.pluginId) &&
        !params.completedPluginIds?.includes(pending.pluginId),
    )
  ) {
    return;
  }
  if (
    statMigrationPath(params.target.storePath) ||
    recorded.sources.some((source) => statMigrationPath(source.path))
  ) {
    return;
  }
  runOpenClawStateWriteTransaction(
    ({ db }) =>
      withDeferredPluginMigrationsCurrent({ env: params.env, expectedPending }, () => {
        params.assertCurrent?.();
        if (
          !isDeepStrictEqual(
            readDeferredPluginSessionImportReceipt({ ...params, database: db }),
            receipt,
          )
        ) {
          throw new Error("Deferred session import receipt changed before retirement.");
        }
        if (
          statMigrationPath(params.target.storePath) ||
          recorded.sources.some((source) => statMigrationPath(source.path))
        ) {
          return;
        }
        readDeferredPluginSessionImport({ ...params, database: db });
        markLegacyMigrationSourceRemovedInDatabase(db, receipt.sourceKey);
      }),
    { env: params.env },
    { operationLabel: "state.retire-plugin-session-source" },
  );
}
