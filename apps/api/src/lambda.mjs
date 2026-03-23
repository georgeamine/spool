import { handle } from "hono/aws-lambda";
import app from "./app.mjs";

export const handler = handle(app);
