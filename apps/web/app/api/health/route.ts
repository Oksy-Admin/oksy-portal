// Liveness check for deploys. Returns no data and reads no secrets.
export function GET() {
  return Response.json({ ok: true, app: "oksy-portal", milestone: "M1" });
}
