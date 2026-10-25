import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { addCoreDataWriteColumns, createSyntheticQuickenDb } from "./fixtures/quicken.js";
import { splitTransaction } from "../tools/split-transaction.js";

describe("split_transaction", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qmac-split-"));
    const path = join(dir, "data");
    const setup = createSyntheticQuickenDb(path);
    addCoreDataWriteColumns(setup);
    setup.exec("UPDATE ZCASHFLOWTRANSACTIONENTRY SET ZNOTE = 'kept' WHERE Z_PK = 1005");
    setup.close();
    db = new Database(path, { readonly: true });
    process.env.QUICKEN_ALLOW_WRITES = "1";
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.QUICKEN_ALLOW_WRITES;
  });

  const entries = (txId: number) =>
    db
      .prepare(
        `SELECT Z_PK, Z_ENT, Z_OPT, ZQUICKENID, ZSEQUENCENUMBER, ZCATEGORYTAG, ZAMOUNT, ZNOTE,
                Z81_PARENT, ZGUID, ZDELETIONCOUNT, ZMISCFLAGS, ZCREATIONTIMESTAMP
         FROM ZCASHFLOWTRANSACTIONENTRY WHERE ZPARENT = ? ORDER BY ZSEQUENCENUMBER`
      )
      .all(txId) as any[];
  const counters = () => ({
    zMax: (
      db
        .prepare(
          "SELECT Z_MAX FROM Z_PRIMARYKEY WHERE Z_NAME = 'CashFlowTransactionEntry'"
        )
        .get() as any
    ).Z_MAX,
    quickenId: db
      .prepare(
        "SELECT ZINTVALUE, Z_OPT FROM ZDOCUMENTPROPERTY WHERE ZNAME = 'CashFlowTransactionEntryId'"
      )
      .get() as any,
  });

  it("reuses the existing entry as split 1 and inserts the rest with fresh IDs", () => {
    const result = splitTransaction(db, {
      transaction_id: 104,
      entries: [
        { amount: -6.25, category_id: 11 },
        { amount: -3.75, category_id: 12, vendor: "Cafe", memo: "lunch" },
      ],
    });

    expect(result).toEqual({ transaction_id: 104, entry_ids: [1005, 1010] });
    const [first, second] = entries(104);
    expect(first).toMatchObject({
      Z_PK: 1005,
      Z_OPT: 2,
      ZSEQUENCENUMBER: 1,
      ZCATEGORYTAG: 11,
      ZAMOUNT: -6.25,
      ZNOTE: "kept",
    });
    expect(second).toMatchObject({
      Z_PK: 1010,
      Z_ENT: 15,
      Z_OPT: 1,
      ZQUICKENID: 5010,
      ZSEQUENCENUMBER: 2,
      ZCATEGORYTAG: 12,
      ZAMOUNT: -3.75,
      ZNOTE: "Cafe: lunch",
      Z81_PARENT: 81,
      ZDELETIONCOUNT: 0,
      ZMISCFLAGS: 0,
    });
    expect(second.ZGUID).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/
    );
    expect(second.ZCREATIONTIMESTAMP).toBeGreaterThan(0);
    expect(counters()).toEqual({ zMax: 1010, quickenId: { ZINTVALUE: 5010, Z_OPT: 2 } });
    expect(
      (db.prepare("SELECT Z_OPT FROM ZTRANSACTION WHERE Z_PK = 104").get() as any).Z_OPT
    ).toBe(2);
  });

  it("rejects entries that do not sum to the transaction amount", () => {
    expect(() =>
      splitTransaction(db, {
        transaction_id: 104,
        entries: [
          { amount: -6, category_id: 11 },
          { amount: -3, category_id: 12 },
        ],
      })
    ).toThrow(/sum/);
    expect(entries(104)).toHaveLength(1);
    expect(counters().zMax).toBe(1009);
  });

  it("rejects a transaction that is already split", () => {
    expect(() =>
      splitTransaction(db, {
        transaction_id: 100,
        entries: [
          { amount: -50, category_id: 11 },
          { amount: -50, category_id: 12 },
        ],
      })
    ).toThrow(/exactly 1 entry/);
  });

  it("rejects a transfer", () => {
    expect(() =>
      splitTransaction(db, {
        transaction_id: 103,
        entries: [
          { amount: -30, category_id: 11 },
          { amount: -5, category_id: 12 },
        ],
      })
    ).toThrow(/transfer/);
  });

  it("rejects an unknown category and leaves the counters alone", () => {
    expect(() =>
      splitTransaction(db, {
        transaction_id: 104,
        entries: [
          { amount: -5, category_id: 11 },
          { amount: -5, category_id: 20 },
        ],
      })
    ).toThrow(/category 20/);
    expect(counters().quickenId.ZINTVALUE).toBe(5009);
  });

  it("refuses to allocate when a counter is behind the existing rows", () => {
    const rw = new Database(db.name);
    rw.exec("UPDATE ZDOCUMENTPROPERTY SET ZINTVALUE = 4000");
    rw.close();
    expect(() =>
      splitTransaction(db, {
        transaction_id: 104,
        entries: [
          { amount: -5, category_id: 11 },
          { amount: -5, category_id: 12 },
        ],
      })
    ).toThrow(/counter/);
    expect(entries(104)).toHaveLength(1);
  });

  it("refuses when writes are not enabled", () => {
    delete process.env.QUICKEN_ALLOW_WRITES;
    expect(() =>
      splitTransaction(db, {
        transaction_id: 104,
        entries: [
          { amount: -5, category_id: 11 },
          { amount: -5, category_id: 12 },
        ],
      })
    ).toThrow(/QUICKEN_ALLOW_WRITES/);
  });
});
