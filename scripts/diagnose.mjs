import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await sb
  .from("merge_jobs")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(5);

if (error) {
  console.error("Query error:", error.message);
  process.exit(1);
}

console.log(`Found ${data.length} jobs. Columns on first row:`);
if (data[0]) console.log(Object.keys(data[0]));
console.log();

for (const j of data) {
  console.log("---");
  console.log("id:", j.id);
  console.log("platform:", j.platform);
  console.log("status:", j.status);
  console.log("result_activity_id:", j.result_activity_id);
  console.log("result_start_time:", j.result_start_time ?? "(NULL)");
  console.log("originals_storage_keys.length:", j.originals_storage_keys?.length ?? 0);
  console.log("merged_storage_key:", j.merged_storage_key ?? "(NULL)");
  console.log("source_activity_ids:", j.source_activity_ids);
  console.log("created_at:", j.created_at);
}
