import { createClient } from "@supabase/supabase-js";
import { Decoder, Stream } from "@garmin/fitsdk";
import "dotenv/config";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: jobs } = await sb
  .from("merge_jobs")
  .select("id, originals_storage_keys, created_at")
  .order("created_at", { ascending: false })
  .limit(1);

const job = jobs?.[0];
if (!job?.originals_storage_keys?.length) {
  console.log("No originals to inspect.");
  process.exit(0);
}

for (const key of job.originals_storage_keys) {
  console.log(`\n=== ${key} ===`);
  const { data: blob } = await sb.storage.from("originals").download(key);
  const buf = Buffer.from(await blob.arrayBuffer());

  // Strip zip if needed
  let fit = buf;
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const fitEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".fit")) ?? entries[0];
    fit = fitEntry.getData();
    console.log(`(unzipped from ${buf.length} to ${fit.length} bytes)`);
  }

  const stream = Stream.fromBuffer(new Uint8Array(fit));
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) {
    console.log("Not a FIT file!");
    continue;
  }
  const { messages } = decoder.read({
    applyScaleAndOffset: true,
    convertDateTimesToDates: true,
    convertTypesToStrings: true,
  });
  const r0 = messages.recordMesgs?.[0];
  const rLast = messages.recordMesgs?.at(-1);
  const session = messages.sessionMesgs?.[0];
  console.log(`Records: ${messages.recordMesgs?.length ?? 0}`);
  console.log(`First record: ts=${r0?.timestamp?.toISOString?.()} dist=${r0?.distance} lat=${r0?.positionLat} lng=${r0?.positionLong} speed=${r0?.speed}`);
  console.log(`Last record:  ts=${rLast?.timestamp?.toISOString?.()} dist=${rLast?.distance} lat=${rLast?.positionLat} lng=${rLast?.positionLong} speed=${rLast?.speed}`);
  if (session) {
    console.log(`Session: sport=${session.sport}/${session.subSport} dist=${session.totalDistance} elapsed=${session.totalElapsedTime}`);
  }
}
