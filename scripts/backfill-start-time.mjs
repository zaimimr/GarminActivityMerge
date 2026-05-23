import { createClient } from "@supabase/supabase-js";
import { Decoder, Stream } from "@garmin/fitsdk";
import AdmZip from "adm-zip";
import "dotenv/config";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: jobs, error } = await sb
  .from("merge_jobs")
  .select("id, merged_storage_key, originals_storage_keys, result_start_time, status")
  .eq("status", "succeeded")
  .is("result_start_time", null);
if (error) throw error;

console.log(`Backfilling ${jobs.length} jobs...`);
for (const job of jobs) {
  let earliest = null;
  const keys = job.merged_storage_key ? [job.merged_storage_key] : (job.originals_storage_keys ?? []);
  if (keys.length === 0) {
    console.warn(`  ${job.id}: no stored file, skipping`);
    continue;
  }
  for (const key of keys) {
    const { data: blob, error: dlErr } = await sb.storage.from("originals").download(key);
    if (dlErr) {
      console.warn(`  ${job.id}: download ${key} failed (${dlErr.message})`);
      continue;
    }
    let buf = Buffer.from(await blob.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries();
      const fit = entries.find((e) => e.entryName.toLowerCase().endsWith(".fit")) ?? entries[0];
      buf = fit.getData();
    }
    const stream = Stream.fromBuffer(new Uint8Array(buf));
    const decoder = new Decoder(stream);
    if (!decoder.isFIT()) continue;
    const { messages } = decoder.read({ convertDateTimesToDates: true });
    const start = messages.recordMesgs?.[0]?.timestamp ?? messages.sessionMesgs?.[0]?.startTime;
    if (!start) continue;
    const d = start instanceof Date ? start : new Date(start);
    if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
  }
  if (!earliest) {
    console.warn(`  ${job.id}: no timestamp recoverable, skipping`);
    continue;
  }
  const iso = earliest.toISOString();
  const { error: updErr } = await sb
    .from("merge_jobs")
    .update({ result_start_time: iso })
    .eq("id", job.id);
  if (updErr) {
    console.warn(`  ${job.id}: update failed (${updErr.message})`);
  } else {
    console.log(`  ${job.id}: set result_start_time=${iso} (source=${job.merged_storage_key ? "merged" : "original"})`);
  }
}
console.log("Done.");
