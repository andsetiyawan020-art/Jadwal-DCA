import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Stores app transactions (currently: BUY trades imported from Indodax Trade
 * History). `id` is the caller-supplied stable id (e.g. `indodax:<tradeId>`)
 * so re-importing the same trade history is idempotent via
 * onConflictDoNothing on this primary key — it is NOT a serial/auto id.
 */
export const transactionsTable = pgTable("transactions", {
  id: text("id").primaryKey(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  type: text("type", { enum: ["BUY", "SELL"] }).notNull().default("BUY"),
  coin: text("coin", { enum: ["BTC", "ETH"] }).notNull(),
  jumlahBeli: numeric("jumlah_beli", { mode: "number" }).notNull(),
  fee: numeric("fee", { mode: "number" }).notNull(),
  hargaBeliPerCoin: numeric("harga_beli_per_coin", { mode: "number" }).notNull(),
  source: text("source", { enum: ["manual", "indodax_sync"] }).notNull().default("manual"),
  pair: text("pair"),
  orderId: text("order_id"),
  tradeId: text("trade_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type TransactionRow = typeof transactionsTable.$inferSelect;
