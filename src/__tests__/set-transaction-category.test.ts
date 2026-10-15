import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { addCoreDataWriteColumns, createSyntheticQuickenDb } from "./fixtures/quicken.js";
import { setTransactionCategory } from "../tools/set-transaction-category.js";

describe("set_transaction_category", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qmac-write-"));
    const path = join(dir, "data");
    const setup = createSyntheticQuickenDb(path);
    addCoreDataWriteColumns(setup);
    setup.exec("UPDATE ZCASHFLOWTRANSACTIONENTRY SET Z_OPT = 3 WHERE Z_PK = 1000");
    setup.close();
    db = new Database(path, { readonly: true });
    process.env.QUICKEN_ALLOW_WRITES = "1";
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.QUICKEN_ALLOW_WRITES;
  });

  const entry = (id: number) =>
    db
      .prepare(
        "SELECT ZCATEGORYTAG, Z_OPT, ZMODIFICATIONTIMESTAMP FROM ZCASHFLOWTRANSACTIONENTRY WHERE Z_PK = ?"
      )
      .get(id) as { ZCATEGORYTAG: number; Z_OPT: number; ZMODIFICATIONTIMESTAMP: number };

  it("changes one split entry and bumps Z_OPT and the modification timestamp", () => {
    const result = setTransactionCategory(db, { entry_id: 1000, category_id: 12 });

    expect(result).toEqual({
      entry_id: 1000,
      transaction_id: 100,
      previous_category: "Groceries",
      category: "Dining",
    });
    const row = entry(1000);
    expect(row.ZCATEGORYTAG).toBe(12);
    expect(row.Z_OPT).toBe(4);
    expect(row.ZMODIFICATIONTIMESTAMP).toBeGreaterThan(0);
    expect(entry(1001).ZCATEGORYTAG).toBe(12);
    expect(entry(1001).Z_OPT).toBe(1);
  });

  it("refuses when writes are not enabled", () => {
    delete process.env.QUICKEN_ALLOW_WRITES;
    expect(() => setTransactionCategory(db, { entry_id: 1000, category_id: 12 })).toThrow(
      /QUICKEN_ALLOW_WRITES/
    );
    expect(entry(1000).ZCATEGORYTAG).toBe(11);
  });

  it("rejects an unknown entry", () => {
    expect(() => setTransactionCategory(db, { entry_id: 9999, category_id: 12 })).toThrow(
      /entry 9999/
    );
  });

  it("rejects a tag that is not a category", () => {
    expect(() => setTransactionCategory(db, { entry_id: 1000, category_id: 20 })).toThrow(
      /category 20/
    );
    expect(entry(1000).ZCATEGORYTAG).toBe(11);
  });

  it("rejects a transfer entry", () => {
    expect(() => setTransactionCategory(db, { entry_id: 1004, category_id: 12 })).toThrow(
      /transfer/
    );
  });
});
