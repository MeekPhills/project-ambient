import { statusManifest } from "../status-model";

export async function GET() {
  return Response.json(statusManifest, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
