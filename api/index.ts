import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApp } from "../server/_core/app";

const app = createApp({ serveClient: false });

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}
