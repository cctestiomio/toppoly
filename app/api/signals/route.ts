import { NextResponse } from "next/server";
import { buildSignals } from "@/lib/signals";

export const revalidate = 600;

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minTraders = parsePositiveInt(searchParams.get("min"), 3, 2, 10);
  const topN = parsePositiveInt(searchParams.get("top"), 50, 10, 50);

  try {
    const payload = await buildSignals({ topN, minTraders });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
