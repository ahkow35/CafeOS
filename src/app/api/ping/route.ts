/**
 * Health-check endpoint: GET /api/ping
 *
 * Returns a simple 200 OK JSON response with no authentication or database calls.
 * Used by UptimeRobot (or similar uptime monitoring services) to ping the app
 * every 5 minutes and prevent the server from going cold / spinning down.
 *
 * Do NOT add authentication, database queries, or heavy logic to this route.
 */

import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json({ status: "ok" });
}
