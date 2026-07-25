import { Router, type IRouter } from "express";
import { db, transactionsTable } from "@workspace/db";
import {
  ImportTransactionsBody,
  ImportTransactionsResponse,
  ListTransactionsResponse,
  CreateTransactionBody,
  CreateTransactionResponse
} from "@workspace/api-zod";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/transactions", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(transactionsTable);
    req.log.info({ count: rows.length }, "Fetching all transactions from database");

    // Zod parsing handles the numeric-string to number conversion via coercion
    const parsed = ListTransactionsResponse.safeParse(rows);
    if (!parsed.success) {
      req.log.error({ error: parsed.error.message }, "Failed to parse transactions from DB with Zod");
      res.status(500).json({ error: "Internal server error: data mapping failed" });
      return;
    }

    res.json(parsed.data);
  } catch (err) {
    req.log.error({ err: err instanceof Error ? err.message : String(err) }, "Error in GET /transactions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transactions", async (req, res): Promise<void> => {
  try {
    const parsed = CreateTransactionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const inserted = await db
      .insert(transactionsTable)
      .values(parsed.data)
      .onConflictDoUpdate({
        target: transactionsTable.id,
        set: {
          date: sql`EXCLUDED.date`,
          type: sql`EXCLUDED.type`,
          coin: sql`EXCLUDED.coin`,
          jumlahBeli: sql`EXCLUDED.jumlah_beli`,
          fee: sql`EXCLUDED.fee`,
          hargaBeliPerCoin: sql`EXCLUDED.harga_beli_per_coin`,
          source: sql`EXCLUDED.source`,
        }
      })
      .returning();

    res.status(201).json(CreateTransactionResponse.parse(inserted[0]));
  } catch (err) {
    req.log.error({ err }, "Error creating/updating transaction");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    await db.delete(transactionsTable).where(eq(transactionsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Error deleting transaction");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/transactions/import", async (req, res): Promise<void> => {
  req.log.info({ count: req.body?.transactions?.length }, "Received import request");

  const parsed = ImportTransactionsBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.error({ error: parsed.error.message }, "Import validation failed");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { transactions } = parsed.data;
  if (transactions.length === 0) {
    res.json(ImportTransactionsResponse.parse({ imported: 0, skipped: 0, transactions: [] }));
    return;
  }

  // Melakukan UPDATE jika ID sudah ada untuk memperbaiki data lama yang salah (misal: jumlahBeli = 0)
  const inserted = await db
    .insert(transactionsTable)
    .values(transactions)
    .onConflictDoUpdate({
      target: transactionsTable.id,
      set: {
        date: sql`EXCLUDED.date`,
        type: sql`EXCLUDED.type`,
        coin: sql`EXCLUDED.coin`,
        jumlahBeli: sql`EXCLUDED.jumlah_beli`,
        fee: sql`EXCLUDED.fee`,
        hargaBeliPerCoin: sql`EXCLUDED.harga_beli_per_coin`,
        source: sql`EXCLUDED.source`,
      }
    })
    .returning();

  req.log.info(
    { attempted: transactions.length, imported: inserted.length },
    "Imported/Updated transactions in database",
  );

  const totalCount = await db.select().from(transactionsTable);
  req.log.info({ totalAfterImport: totalCount.length }, "Total transactions in database now");

  res.json(
    ImportTransactionsResponse.parse({
      imported: inserted.length,
      skipped: 0, // Dalam mode Update, kita menganggap semua 'attempted' berhasil diproses
      transactions: inserted,
    }),
  );
});

export default router;
