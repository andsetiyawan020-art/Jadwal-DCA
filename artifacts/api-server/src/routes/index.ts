import { Router, type IRouter } from "express";
import healthRouter from "./health";
import priceRouter from "./price";
import transactionsRouter from "./transactions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(priceRouter);
router.use(transactionsRouter);

export default router;
