/**
 * Vercel serverless entry — reuses the Express app as-is (single deployment:
 * static frontend + /api from one Vercel project, no separate backend host).
 *
 * The secret Plunk key still lives server-side: this function runs on Vercel's
 * servers, never in the browser. Local dev keeps using backend/src/server.js.
 */
import app from '../backend/src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
