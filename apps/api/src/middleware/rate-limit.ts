import rateLimit from "express-rate-limit";
import { fail } from "../lib/http.js";

export const publicLeadSubmissionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  handler: (_req, res) => {
    return fail(
      res,
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many lead submissions from this IP. Please try again later."
    );
  }
});
