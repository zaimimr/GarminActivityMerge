import { supabaseAdmin } from "./supabase";

const BUCKET = "originals";

let bucketChecked = false;

async function ensureBucket(): Promise<void> {
  if (bucketChecked) return;
  const sb = supabaseAdmin();
  const { data } = await sb.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false });
    if (error && !error.message?.toLowerCase().includes("already")) throw error;
  }
  bucketChecked = true;
}

export async function saveOriginal(
  userId: string,
  jobId: string,
  platform: "strava" | "garmin",
  activityId: string,
  buf: Buffer
): Promise<string> {
  await ensureBucket();
  const key = `${userId}/${jobId}/${platform}-${activityId}.fit`;
  const u8 = new Uint8Array(buf);
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(key, u8, {
    contentType: "application/octet-stream",
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
  return key;
}

export async function loadOriginal(key: string): Promise<Buffer> {
  await ensureBucket();
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`Storage download failed for ${key}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteOriginal(key: string): Promise<void> {
  await ensureBucket();
  await supabaseAdmin().storage.from(BUCKET).remove([key]);
}

export async function saveMerged(userId: string, jobId: string, buf: Buffer): Promise<string> {
  await ensureBucket();
  const key = `${userId}/${jobId}/merged.fit`;
  const u8 = new Uint8Array(buf);
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(key, u8, {
    contentType: "application/octet-stream",
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
  return key;
}

export async function signedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(key, expiresInSeconds);
  if (error || !data) throw new Error(`Signed URL failed for ${key}: ${error?.message}`);
  return data.signedUrl;
}
