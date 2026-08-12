import { statusManifest } from "../status-model";

export async function GET() {
  return Response.json(statusManifest, {
    headers: {
      "cache-control": "public, max-age=60, s-maxage=300",
      "x-content-type-options": "nosniff",
    },
  });
}
