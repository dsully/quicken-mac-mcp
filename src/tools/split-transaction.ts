/**
 * split_transaction tool — Turn a single-entry transaction into a split.
 *
 * The existing entry becomes split 1; the rest are inserted. Each insert
 * allocates two IDs Quicken also tracks: Z_PK from Z_PRIMARYKEY.Z_MAX and
 * ZQUICKENID from the ZDOCUMENTPROPERTY 'CashFlowTransactionEntryId' counter.
 * Quicken stores the payee per transaction, so a per-entry vendor goes into
 * the entry memo. Disabled unless QUICKEN_ALLOW_WRITES=1.
 */

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { getCategoryTagEntityId, nowCoreData, withQuickenWrite } from "../db.js";

interface SplitEntry {
  amount: number;
  category_id: number;
  vendor?: string;
  memo?: string;
}

const cents = (amount: number) => Math.round(amount * 100);
const memoText = (e: SplitEntry) => [e.vendor, e.memo].filter(Boolean).join(": ") || null;

export function splitTransaction(
  db: Database.Database,
  args: { transaction_id: number; entries: SplitEntry[] }
) {
  const txId = args.transaction_id;
  return withQuickenWrite(db, (rw) => {
    if (args.entries.length < 2) throw new Error("A split needs at least 2 entries.");

    const tx = rw
      .prepare("SELECT Z_ENT AS ent, ZAMOUNT AS amount FROM ZTRANSACTION WHERE Z_PK = ?")
      .get(txId) as { ent: number; amount: number } | undefined;
    if (!tx) throw new Error(`No transaction ${txId}.`);

    const existing = rw
      .prepare(
        "SELECT Z_PK AS id, ZTRANSFER AS transfer FROM ZCASHFLOWTRANSACTIONENTRY WHERE ZPARENT = ?"
      )
      .all(txId) as { id: number; transfer: string | null }[];
    if (existing.length !== 1) {
      throw new Error(
        `Transaction ${txId} has ${existing.length} entries; only a transaction with exactly 1 entry can be split.`
      );
    }
    if (existing[0].transfer?.trim())
      throw new Error(`Transaction ${txId} is a transfer.`);

    const total = args.entries.reduce((sum, e) => sum + cents(e.amount), 0);
    if (total !== cents(tx.amount)) {
      throw new Error(
        `Entries sum to ${total / 100}, but transaction ${txId} is ${tx.amount}.`
      );
    }

    const categoryTagEntityId = getCategoryTagEntityId(rw);
    const isCategory = rw.prepare("SELECT 1 FROM ZTAG WHERE Z_PK = ? AND Z_ENT = ?");
    for (const e of args.entries) {
      if (!isCategory.get(e.category_id, categoryTagEntityId)) {
        throw new Error(`No category ${e.category_id}.`);
      }
    }

    // Core Data names the polymorphic parent column after an entity number that varies per file.
    const parentColumn = (
      rw
        .prepare(
          "SELECT name FROM pragma_table_info('ZCASHFLOWTRANSACTIONENTRY') WHERE name GLOB 'Z[0-9]*_PARENT'"
        )
        .get() as { name: string } | undefined
    )?.name;
    if (!parentColumn)
      throw new Error("ZCASHFLOWTRANSACTIONENTRY has no Z<n>_PARENT column.");

    const pk = rw
      .prepare(
        "SELECT Z_ENT AS ent, Z_MAX AS max FROM Z_PRIMARYKEY WHERE Z_NAME = 'CashFlowTransactionEntry'"
      )
      .get() as { ent: number; max: number } | undefined;
    const quickenId = rw
      .prepare(
        "SELECT ZINTVALUE AS max FROM ZDOCUMENTPROPERTY WHERE ZNAME = 'CashFlowTransactionEntryId'"
      )
      .get() as { max: number } | undefined;
    if (!pk || !quickenId) throw new Error("Cannot find the split entry ID counters.");
    const used = rw
      .prepare(
        "SELECT MAX(Z_PK) AS pk, MAX(ZQUICKENID) AS quickenId FROM ZCASHFLOWTRANSACTIONENTRY"
      )
      .get() as { pk: number; quickenId: number };
    if (used.pk > pk.max || used.quickenId > quickenId.max) {
      throw new Error(
        "A split entry ID counter is behind the existing rows; refusing to allocate."
      );
    }

    const [first, ...rest] = args.entries;
    const now = nowCoreData();

    rw.prepare(
      "UPDATE Z_PRIMARYKEY SET Z_MAX = Z_MAX + ? WHERE Z_NAME = 'CashFlowTransactionEntry'"
    ).run(rest.length);
    rw.prepare(
      `UPDATE ZDOCUMENTPROPERTY SET ZINTVALUE = ZINTVALUE + ?, Z_OPT = COALESCE(Z_OPT, 0) + 1
       WHERE ZNAME = 'CashFlowTransactionEntryId'`
    ).run(rest.length);

    rw.prepare(
      `UPDATE ZCASHFLOWTRANSACTIONENTRY
       SET ZAMOUNT = ?, ZCATEGORYTAG = ?, ZNOTE = COALESCE(?, ZNOTE), ZSEQUENCENUMBER = 1,
           Z_OPT = COALESCE(Z_OPT, 0) + 1, ZMODIFICATIONTIMESTAMP = ?
       WHERE Z_PK = ?`
    ).run(
      cents(first.amount) / 100,
      first.category_id,
      memoText(first),
      now,
      existing[0].id
    );

    const insert = rw.prepare(
      `INSERT INTO ZCASHFLOWTRANSACTIONENTRY
         (Z_PK, Z_ENT, Z_OPT, ZDELETIONCOUNT, ZMISCFLAGS, ZQUICKENID, ZSEQUENCENUMBER,
          ZCATEGORYTAG, ZPARENT, ${parentColumn}, ZCREATIONTIMESTAMP, ZMODIFICATIONTIMESTAMP,
          ZAMOUNT, ZGUID, ZNOTE)
       VALUES (?, ?, 1, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const entryIds = [existing[0].id];
    rest.forEach((e, i) => {
      const id = pk.max + i + 1;
      insert.run(
        id,
        pk.ent,
        quickenId.max + i + 1,
        i + 2,
        e.category_id,
        txId,
        tx.ent,
        now,
        now,
        cents(e.amount) / 100,
        randomUUID().toUpperCase(),
        memoText(e)
      );
      entryIds.push(id);
    });

    rw.prepare(
      "UPDATE ZTRANSACTION SET Z_OPT = COALESCE(Z_OPT, 0) + 1, ZMODIFICATIONTIMESTAMP = ? WHERE Z_PK = ?"
    ).run(now, txId);

    return { transaction_id: txId, entry_ids: entryIds };
  });
}
