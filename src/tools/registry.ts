import { z } from "zod";
import type Database from "better-sqlite3";
import { listAccounts } from "./list-accounts.js";
import { listCategories } from "./list-categories.js";
import { queryTransactions } from "./query-transactions.js";
import { spendingByCategory } from "./spending-by-category.js";
import { spendingOverTime } from "./spending-over-time.js";
import { searchPayees } from "./search-payees.js";
import { listPortfolio } from "./list-portfolio.js";
import { rawQuery } from "./raw-query.js";
import { setTransactionCategory } from "./set-transaction-category.js";
import { splitTransaction } from "./split-transaction.js";

/** Parameter type representation for help display and dynamic CLI parsing. */
export type ParamType = "string" | "number" | "boolean" | "enum" | "array";

export interface ToolParamDef {
  type: ParamType;
  description: string;
  optional: boolean;
  enumValues?: string[];
  zod: z.ZodType<any>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, ToolParamDef>;
  handler: (db: Database.Database, args: any) => any;
  writes?: boolean;
}

export const toolsRegistry: ToolDef[] = [
  {
    name: "list_accounts",
    description:
      "List all Quicken accounts with name, type, and active/closed status. Optionally filter by account type (case-insensitive).",
    parameters: {
      account_type: {
        type: "string",
        description:
          'Filter by account type, e.g. "checking", "creditcard", "savings", "mortgage"',
        optional: true,
        zod: z.string().optional(),
      },
    },
    handler: listAccounts,
  },
  {
    name: "list_categories",
    description:
      "List all Quicken category tags with their parent category hierarchy. Categories classify transactions (e.g., Food & Dining > Groceries).",
    parameters: {
      type: {
        type: "enum",
        description: 'Filter by category type: "expense" or "income"',
        optional: true,
        enumValues: ["expense", "income"],
        zod: z.enum(["expense", "income"]).optional(),
      },
    },
    handler: listCategories,
  },
  {
    name: "query_transactions",
    description:
      "Query Quicken transactions with flexible filters. Returns one row per split entry — a single transaction may appear multiple times if it has multiple category splits.",
    parameters: {
      start_date: {
        type: "string",
        description: "Start date (ISO 8601, e.g., 2024-01-01)",
        optional: true,
        zod: z.string().optional(),
      },
      end_date: {
        type: "string",
        description: "End date (ISO 8601, e.g., 2024-12-31)",
        optional: true,
        zod: z.string().optional(),
      },
      account_types: {
        type: "array",
        description: 'Filter by account types, e.g. ["checking", "creditcard"]',
        optional: true,
        zod: z.array(z.string()).optional(),
      },
      account_names: {
        type: "array",
        description: "Filter by specific account names",
        optional: true,
        zod: z.array(z.string()).optional(),
      },
      min_amount: {
        type: "number",
        description: "Minimum transaction amount",
        optional: true,
        zod: z.number().optional(),
      },
      max_amount: {
        type: "number",
        description: "Maximum transaction amount",
        optional: true,
        zod: z.number().optional(),
      },
      payee_search: {
        type: "string",
        description: "Search payee name (LIKE match, case-insensitive)",
        optional: true,
        zod: z.string().optional(),
      },
      category: {
        type: "string",
        description: "Filter by category or parent category name (LIKE match)",
        optional: true,
        zod: z.string().optional(),
      },
      limit: {
        type: "number",
        description: "Max rows to return (default 100, max 1000)",
        optional: true,
        zod: z.number().optional(),
      },
    },
    handler: queryTransactions,
  },
  {
    name: "spending_by_category",
    description:
      "Aggregate consumer spending (negative splits) by category for an inclusive date range. Excludes transfers and report-excluded transactions, preserves an (Uncategorized) bucket, and defaults to checking + credit-card accounts.",
    parameters: {
      start_date: {
        type: "string",
        description: "Start date (ISO 8601, e.g., 2024-01-01)",
        optional: false,
        zod: z.string().describe("Start date (ISO 8601)"),
      },
      end_date: {
        type: "string",
        description: "End date (ISO 8601, e.g., 2024-12-31)",
        optional: false,
        zod: z.string().describe("End date (ISO 8601)"),
      },
      account_types: {
        type: "array",
        description: 'Account types to include (default: ["checking", "creditcard"])',
        optional: true,
        zod: z.array(z.string()).optional(),
      },
      account_names: {
        type: "array",
        description:
          "Filter by specific account names (overrides account_types when provided)",
        optional: true,
        zod: z.array(z.string()).optional(),
      },
      group_by: {
        type: "enum",
        description:
          'Group by "category" (subcategory level) or "parent_category" (top-level). Default: "parent_category"',
        optional: true,
        enumValues: ["category", "parent_category"],
        zod: z.enum(["category", "parent_category"]).optional(),
      },
    },
    handler: spendingByCategory,
  },
  {
    name: "spending_over_time",
    description:
      "Monthly consumer-spending totals (negative splits) for an inclusive date range, optionally by parent category. Excludes transfers and report-excluded transactions, labels uncategorized rows when grouped, and defaults to checking + credit-card accounts.",
    parameters: {
      start_date: {
        type: "string",
        description: "Start date (ISO 8601, e.g., 2024-01-01)",
        optional: false,
        zod: z.string().describe("Start date (ISO 8601)"),
      },
      end_date: {
        type: "string",
        description: "End date (ISO 8601, e.g., 2024-12-31)",
        optional: false,
        zod: z.string().describe("End date (ISO 8601)"),
      },
      account_types: {
        type: "array",
        description: 'Account types to include (default: ["checking", "creditcard"])',
        optional: true,
        zod: z.array(z.string()).optional(),
      },
      account_names: {
        type: "array",
        description:
          "Filter by specific account names (overrides account_types when provided)",
        optional: true,
        zod: z.array(z.string()).optional(),
      },
      group_by_category: {
        type: "boolean",
        description: "If true, break down each month by parent category (default: false)",
        optional: true,
        zod: z.boolean().optional(),
      },
    },
    handler: spendingOverTime,
  },
  {
    name: "search_payees",
    description:
      "Search payees by name (case-insensitive LIKE match). Returns payee name and total transaction count, sorted by frequency.",
    parameters: {
      query: {
        type: "string",
        description: "Search term for payee name (LIKE match)",
        optional: false,
        zod: z.string().describe("Search term for payee name (LIKE match)"),
      },
      limit: {
        type: "number",
        description: "Max results to return (default 50, max 500)",
        optional: true,
        zod: z.number().optional(),
      },
    },
    handler: searchPayees,
  },
  {
    name: "list_portfolio",
    description:
      "List current investment holdings across all brokerage/retirement accounts. Shows shares, cost basis, and enriches with stored Quicken quotes to compute market value and gain/loss.",
    parameters: {
      account_names: {
        type: "array",
        description: "Filter to specific account names",
        optional: true,
        zod: z.array(z.string()).optional(),
      },
    },
    handler: listPortfolio,
  },
  {
    name: "raw_query",
    description:
      "Execute an arbitrary read-only SQL query against the Quicken database. Only SELECT statements are allowed. Results limited to 500 rows. Use this for custom analysis not covered by other tools.",
    parameters: {
      sql: {
        type: "string",
        description: "SQL SELECT query to execute",
        optional: false,
        zod: z.string().describe("SQL SELECT query to execute"),
      },
    },
    handler: rawQuery,
  },
  {
    name: "set_transaction_category",
    description:
      "Change the category of one split entry (entry_id from query_transactions). Writes to the Quicken database, so it is disabled unless QUICKEN_ALLOW_WRITES=1. Back up the .quicken bundle first.",
    parameters: {
      entry_id: {
        type: "number",
        description: "Split entry ID (entry_id column from query_transactions)",
        optional: false,
        zod: z.number().int().describe("Split entry ID"),
      },
      category_id: {
        type: "number",
        description: "Target category ID (id column from list_categories)",
        optional: false,
        zod: z.number().int().describe("Target category ID"),
      },
    },
    handler: setTransactionCategory,
    writes: true,
  },
  {
    name: "split_transaction",
    description:
      "Turn a transaction with exactly one entry into a split. The existing entry becomes split 1 and the others are inserted. Entry amounts must sum to the transaction amount. Quicken has one payee per transaction, so a per-entry vendor is written into that entry's memo. Writes to the Quicken database, so it is disabled unless QUICKEN_ALLOW_WRITES=1. Back up the .quicken bundle first.",
    parameters: {
      transaction_id: {
        type: "number",
        description: "Transaction ID (transaction_id column from query_transactions)",
        optional: false,
        zod: z.number().int().describe("Transaction ID"),
      },
      entries: {
        type: "array",
        description:
          'Split entries, at least 2. Each: {"amount": -12.5, "category_id": 11, "vendor"?: "...", "memo"?: "..."}',
        optional: false,
        zod: z.preprocess(
          // The CLI passes each array item as a JSON string.
          (v) =>
            Array.isArray(v)
              ? v.map((item) => {
                  if (typeof item !== "string") return item;
                  try {
                    return JSON.parse(item);
                  } catch {
                    return item;
                  }
                })
              : v,
          z
            .array(
              z.object({
                amount: z.number(),
                category_id: z.number().int(),
                vendor: z.string().optional(),
                memo: z.string().optional(),
              })
            )
            .min(2)
        ),
      },
    },
    handler: splitTransaction,
    writes: true,
  },
];
