import { createClient } from "@supabase/supabase-js";
import { Decoder, Stream } from "@garmin/fitsdk";
import "dotenv/config";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: jobs, error } = await sb
  .from("merge_jobs")
  .select("id, platform, status, error, merged_storage_key, result_activity_id, created_at")
  .order("created_at", { ascending: false })
  .limit(5);
if (error) throw error;

console.log("Recent merge jobs:");
for (const j of jobs) {
  console.log(`  ${j.created_at} ${j.platform} ${j.status} ${j.result_activity_id ?? ""} key=${j.merged_storage_key ?? "(none)"} ${j.error ? `err=${j.error}` : ""}`);
}
console.log();

const job = jobs.find((j) => j.merged_storage_key);
if (!job) {
  console.log("No job with stored merged FIT.");
  process.exit(0);
}

console.log(`Inspecting merged FIT from job ${job.id} (key=${job.merged_storage_key})`);
const { data: blob, error: dlErr } = await sb.storage.from("originals").download(job.merged_storage_key);
if (dlErr) throw dlErr;
const ab = await blob.arrayBuffer();
const buf = Buffer.from(ab);
console.log(`File size: ${buf.length} bytes`);

const stream = Stream.fromBuffer(new Uint8Array(buf));
const decoder = new Decoder(stream);
console.log(`isFIT: ${decoder.isFIT()}`);
console.log(`checkIntegrity: ${decoder.checkIntegrity()}`);

const { messages, errors } = decoder.read({
  applyScaleAndOffset: true,
  expandComponents: true,
  expandSubFields: true,
  convertDateTimesToDates: true,
  convertTypesToStrings: true,
});
if (errors?.length) console.log("Decode errors:", errors);

const counts = Object.fromEntries(
  Object.entries(messages).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])
);
console.log("Message counts:", counts);

const records = messages.recordMesgs ?? [];
console.log(`\nRecords: ${records.length}`);
if (records.length > 0) {
  const first = records[0];
  const mid = records[Math.floor(records.length / 2)];
  const last = records[records.length - 1];
  for (const [label, r] of [["first", first], ["mid", mid], ["last", last]]) {
    console.log(`  ${label}: ts=${r.timestamp?.toISOString?.() ?? r.timestamp} dist=${r.distance} lat=${r.positionLat} lng=${r.positionLong} hr=${r.heartRate} speed=${r.speed} alt=${r.altitude}`);
  }
}

const session = messages.sessionMesgs?.[0];
if (session) {
  console.log("\nSession:", {
    sport: session.sport,
    subSport: session.subSport,
    startTime: session.startTime?.toISOString?.() ?? session.startTime,
    totalElapsedTime: session.totalElapsedTime,
    totalDistance: session.totalDistance,
    avgSpeed: session.avgSpeed,
    avgHeartRate: session.avgHeartRate,
    totalAscent: session.totalAscent,
  });
}

const lap = messages.lapMesgs?.[0];
if (lap) {
  console.log("\nLap:", {
    startTime: lap.startTime?.toISOString?.() ?? lap.startTime,
    totalDistance: lap.totalDistance,
    totalElapsedTime: lap.totalElapsedTime,
    sport: lap.sport,
  });
}

const fileId = messages.fileIdMesgs?.[0];
console.log("\nFileId:", fileId);
