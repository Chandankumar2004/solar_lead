import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { fail } from "../lib/http.js";
import { env } from "../config/env.js";
import { AuthUser } from "../types.js";
import { prisma } from "../lib/prisma.js";

interface AccessPayload {
  sub: string;
  email: string;
  role: AuthUser["role"];
  typ: "access";
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken as string | undefined;
  if (!token) {
    return fail(res, 401, "UNAUTHORIZED", "Missing access token");
  }

  let payload: AccessPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
  } catch {
    return fail(res, 401, "UNAUTHORIZED", "Invalid or expired access token");
  }

  if (payload.typ !== "access" || !payload.sub) {
    return fail(res, 401, "UNAUTHORIZED", "Invalid token payload");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true
    }
  });
  if (!user || user.status !== "ACTIVE") {
    return fail(res, 401, "UNAUTHORIZED", "User is not active");
  }

  req.user = user;
  return next();
}
