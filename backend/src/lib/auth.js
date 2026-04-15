import { config } from "./config.js";
import { ensureUser } from "./repository.js";

export async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      res.status(401).json({ ok: false, error: "Missing Bearer token" });
      return;
    }

    if (token !== config.devApiToken) {
      res.status(401).json({ ok: false, error: "Invalid token" });
      return;
    }

    await ensureUser({
      userId: config.devUserId,
      email: config.devUserEmail
    });

    req.auth = {
      userId: config.devUserId,
      email: config.devUserEmail
    };

    next();
  } catch (error) {
    next(error);
  }
}
