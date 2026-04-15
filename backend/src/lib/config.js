import dotenv from "dotenv";

// Load .env for local dev while allowing cloud platform env vars to take priority.
dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const databaseSsl =
  process.env.DATABASE_SSL === "true" || /sslmode=require/i.test(databaseUrl);

export const config = {
  port: Number(process.env.PORT || 8787),
  databaseUrl,
  databaseSsl,
  devApiToken: required("DEV_API_TOKEN"),
  devUserId: required("DEV_USER_ID"),
  devUserEmail: required("DEV_USER_EMAIL")
};
