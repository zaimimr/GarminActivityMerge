import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { z } from "zod";
import { requireClient, persistSession, failure } from "@/lib/api";
import { verifyCsrf, csrfRejection, CSRF_HEADER } from "@/lib/csrf";

export const maxDuration = 60;
export const runtime = "nodejs";

const body = z.object({
  activityIds: z.array(z.number().int().positive()).min(1).max(6),
});

/**
 * The only backup that exists: a zip of the untouched original FIT files, saved
 * to the user's own machine before anything is deleted from Garmin. Nothing is
 * kept server-side.
 */
export async function POST(req: NextRequest) {
  if (!(await verifyCsrf(req.headers.get(CSRF_HEADER)))) return csrfRejection();

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid activity selection", code: "VALIDATION", title: "Invalid selection." },
      { status: 400 }
    );
  }

  try {
    const client = await requireClient();
    const zip = new AdmZip();

    for (const activityId of parsed.data.activityIds) {
      const fit = await client.downloadOriginalFit(activityId);
      zip.addFile(`activity_${activityId}.fit`, fit);
    }
    zip.addFile(
      "README.txt",
      Buffer.from(
        [
          "Original Garmin recordings, downloaded before merging.",
          "",
          "To restore one of these activities:",
          "  1. Go to connect.garmin.com",
          "  2. Top-right menu -> Import Data",
          "  3. Drop the .fit file in",
          "",
          "Garmin also keeps deleted activities for about 30 days under",
          "Settings -> Account -> Recover Deleted Activities.",
          "",
          `Activities: ${parsed.data.activityIds.join(", ")}`,
          `Downloaded: ${new Date().toISOString()}`,
        ].join("\n")
      )
    );

    await persistSession(client);
    const buffer = zip.toBuffer();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="garmin-originals-${parsed.data.activityIds.join("-")}.zip"`,
      },
    });
  } catch (e) {
    return failure("originals", e, { activityIds: parsed.data.activityIds });
  }
}
