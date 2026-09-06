import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";

/**
 * The workflow component is installed in Phase 0 even though Carousel only has
 * two steps and doesn't strictly need durable orchestration.
 *
 * The reason is Phase 2: Video Animation has eight steps and three approval
 * gates, and a Convex action times out at 10 minutes. Proving the durable path
 * on the format we understand is much cheaper than discovering its constraints
 * on the format we don't.
 */
const app = defineApp();
app.use(workflow);

export default app;
