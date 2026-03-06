import rateLimit from "express-rate-limit";
import { fail } from "../lib/http.js";

export const publicLeadSubmissionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.headers["user-agent"] ?? "unknown"}`,
  handler: (_req, res) => {
    return fail(
      res,
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many lead submissions from this client. Please try again later."
    );
  }
});

