import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const ACCESS_TTL = "15m";

export function createAccessToken({ userId, email, role }, expiresIn = ACCESS_TTL) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_ACCESS_SECRET in environment");
  }

  return jwt.sign(
    {
      sub: userId,
      email,
      role
    },
    secret,
    { expiresIn }
  );
}

function runCli() {
  const [, , userId, email, role = "EXECUTIVE", expiresIn = ACCESS_TTL] = process.argv;
  if (!userId || !email) {
    console.error(
      "Usage: node src/scripts/create-access-token.js <userId> <email> [role] [expiresIn]"
    );
    process.exit(1);
  }

  const token = createAccessToken({ userId, email, role }, expiresIn);
  console.log(token);
}

if (process.argv[1]?.endsWith("create-access-token.js")) {
  runCli();
}
