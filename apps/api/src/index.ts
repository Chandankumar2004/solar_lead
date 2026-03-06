import { app } from "./app.js";
import { env } from "./config/env.js";
import "./workers/notification.worker.js";
import { startSlaOverdueMonitor } from "./services/sla-overdue.service.js";

app.listen(env.PORT, "0.0.0.0", () => {
  startSlaOverdueMonitor();
  console.log(`API running on http://0.0.0.0:${env.PORT} (localhost:${env.PORT})`);
});
