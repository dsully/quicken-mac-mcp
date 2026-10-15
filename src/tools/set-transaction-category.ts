/**
 * set_transaction_category tool — Change the category of one split entry.
 *
 * Disabled unless QUICKEN_ALLOW_WRITES=1. Core Data requires Z_OPT to be
 * bumped on every UPDATE (see docs/schema.md, "Writing back to the database").
 */

import type Database from "better-sqlite3";
import { getCategoryTagEntityId, nowCoreData, withQuickenWrite } from "../db.js";

export function setTransactionCategory(
  db: Database.Database,
  args: { entry_id: number; category_id: number }
) {
  return withQuickenWrite(db, (rw) => {
    const entry = rw
      .prepare(
        `SELECT s.ZPARENT AS transaction_id, s.ZTRANSFER AS transfer, c.ZNAME AS category
         FROM ZCASHFLOWTRANSACTIONENTRY s
         LEFT JOIN ZTAG c ON s.ZCATEGORYTAG = c.Z_PK
         WHERE s.Z_PK = ?`
      )
      .get(args.entry_id) as
      | { transaction_id: number; transfer: string | null; category: string | null }
      | undefined;
    if (!entry) throw new Error(`No split entry ${args.entry_id}.`);
    if (entry.transfer?.trim()) {
      throw new Error(`Split entry ${args.entry_id} is a transfer and has no category.`);
    }

    const category = rw
      .prepare("SELECT ZNAME AS name FROM ZTAG WHERE Z_PK = ? AND Z_ENT = ?")
      .get(args.category_id, getCategoryTagEntityId(rw)) as { name: string } | undefined;
    if (!category) throw new Error(`No category ${args.category_id}.`);

    rw.prepare(
      `UPDATE ZCASHFLOWTRANSACTIONENTRY
       SET ZCATEGORYTAG = ?, Z_OPT = COALESCE(Z_OPT, 0) + 1, ZMODIFICATIONTIMESTAMP = ?
       WHERE Z_PK = ?`
    ).run(args.category_id, nowCoreData(), args.entry_id);

    return {
      entry_id: args.entry_id,
      transaction_id: entry.transaction_id,
      previous_category: entry.category,
      category: category.name,
    };
  });
}
