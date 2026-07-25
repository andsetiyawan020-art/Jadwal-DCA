import { Router, type IRouter } from "express";

const router: IRouter = Router();

const INDODAX_BASE = "https://indodax.com/api/ticker";

async function fetchTicker(pair: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${INDODAX_BASE}/${pair}`);
  if (!res.ok) throw new Error(`Indodax responded ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

router.get("/price/:pair", async (req, res) => {
  const { pair } = req.params;
  const allowed = ["btcidr", "ethidr"];
  if (!allowed.includes(pair.toLowerCase())) {
    res.status(400).json({ error: "Pair tidak diizinkan" });
    return;
  }
  try {
    const data = await fetchTicker(pair.toLowerCase());
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Gagal fetch harga dari Indodax");
    res.status(502).json({ error: "Gagal mengambil harga dari Indodax" });
  }
});

const COIN_MAP: Record<string, string> = { btcidr: "bitcoin", ethidr: "ethereum" };

interface ChartPoint { time: number; price: number; label: string; }
interface ChartCache { data: ChartPoint[]; fetchedAt: number; }
const chartCache = new Map<string, ChartCache>();
const CHART_TTL = 5 * 60 * 1000;

function formatHour(ts: number): string {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, "0") + ":00";
}

router.get("/chart/:pair", async (req, res) => {
  const { pair } = req.params;
  const coinId = COIN_MAP[pair.toLowerCase()];
  if (!coinId) {
    res.status(400).json({ error: "Pair tidak diizinkan" });
    return;
  }

  const cached = chartCache.get(pair.toLowerCase());
  if (cached && Date.now() - cached.fetchedAt < CHART_TTL) {
    res.json({ prices: cached.data });
    return;
  }

  try {
    const r = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=idr&days=1&interval=hourly`,
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
    const raw = (await r.json()) as { prices: [number, number][] };
    const prices: ChartPoint[] = raw.prices.map(([ts, price]) => ({
      time: ts,
      price: Math.round(price),
      label: formatHour(ts),
    }));
    chartCache.set(pair.toLowerCase(), { data: prices, fetchedAt: Date.now() });
    res.json({ prices });
  } catch (err) {
    req.log.error({ err }, "Gagal fetch chart dari CoinGecko");
    res.status(502).json({ error: "Gagal mengambil data chart" });
  }
});

export default router;
