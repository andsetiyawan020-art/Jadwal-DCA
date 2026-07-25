import pg from 'pg';
const { Pool } = pg;

async function check() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("DATABASE_URL is not set");
    return;
  }
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const res = await pool.query('SELECT count(*) FROM transactions');
    console.log(`Total transactions in DB: ${res.rows[0].count}`);
    const firstFive = await pool.query('SELECT id, coin, jumlah_beli FROM transactions LIMIT 5');
    console.log('First 5 rows:', firstFive.rows);
  } catch (err) {
    console.error('Error querying DB:', err.message);
  } finally {
    await pool.end();
  }
}

check();
