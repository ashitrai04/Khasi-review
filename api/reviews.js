import { Storage } from "@google-cloud/storage";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const CSV_COLUMNS = [
  "reviewer_name",
  "chunk_id",
  "verdict",
  "reviewer_note",
  "corrected_text",
  "corrected_english",
  "reviewed_at",
  "transcript",
  "english_translation",
  "audio_url",
  "source_audio",
  "duration_sec",
];

function getConfig() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  const objectPath =
    process.env.GCS_REVIEWS_CSV_PATH || "ASr audio/sample/reviews/khasi_review_results.csv";

  if (!bucketName) {
    throw new Error("Missing GCS_BUCKET_NAME env var.");
  }
  return { bucketName, objectPath };
}

function getStorageClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (keyJson) {
    let parsed = JSON.parse(keyJson);

    // Handle accidental double-encoded JSON strings from env UIs.
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }

    const credentials = { ...parsed };

    // Vercel env often stores newline escapes in PEM keys.
    if (typeof credentials.private_key === "string") {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n").trim();
    }

    if (!credentials.private_key || !credentials.client_email) {
      throw new Error(
        "Invalid GOOGLE_SERVICE_ACCOUNT_KEY: missing private_key or client_email"
      );
    }

    return new Storage({
      projectId: process.env.GOOGLE_PROJECT_ID || credentials.project_id,
      credentials,
    });
  }

  return new Storage({
    projectId: process.env.GOOGLE_PROJECT_ID,
  });
}

function normalizeRow(row) {
  const out = {};
  for (const c of CSV_COLUMNS) {
    out[c] = String(row?.[c] ?? "");
  }
  return out;
}

async function readRows(file) {
  const [exists] = await file.exists();
  if (!exists) return [];

  const [buf] = await file.download();
  const text = buf.toString("utf-8").trim();
  if (!text) return [];

  const parsed = parse(text, {
    columns: true,
    skip_empty_lines: true,
  });
  return parsed.map(normalizeRow);
}

async function writeRows(file, rows) {
  const csv = stringify(rows.map(normalizeRow), {
    header: true,
    columns: CSV_COLUMNS,
  });

  await file.save(csv, {
    resumable: false,
    contentType: "text/csv; charset=utf-8",
  });
}

function getRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  try {
    const { bucketName, objectPath } = getConfig();
    const storage = getStorageClient();
    const file = storage.bucket(bucketName).file(objectPath);

    if (req.method === "GET") {
      const rows = await readRows(file);
      return res.status(200).json({ count: rows.length, items: rows });
    }

    if (req.method === "POST") {
      const body = getRequestBody(req);
      const reviewerName = String(body.reviewer_name || "").trim();
      const chunkId = String(body.chunk_id || "").trim();

      if (!reviewerName || !chunkId) {
        return res.status(400).json({ error: "reviewer_name and chunk_id are required" });
      }

      const newRow = normalizeRow({
        reviewer_name: reviewerName,
        chunk_id: chunkId,
        verdict: body.verdict || "",
        reviewer_note: body.reviewer_note || "",
        corrected_text: body.corrected_text || "",
        corrected_english: body.corrected_english || "",
        reviewed_at: new Date().toISOString(),
        transcript: body.transcript || "",
        english_translation: body.english_translation || "",
        audio_url: body.audio_url || "",
        source_audio: body.source_audio || "",
        duration_sec: body.duration_sec || "",
      });

      const rows = await readRows(file);
      const idx = rows.findIndex(
        (r) => r.reviewer_name === newRow.reviewer_name && r.chunk_id === newRow.chunk_id
      );

      if (idx >= 0) rows[idx] = newRow;
      else rows.push(newRow);

      await writeRows(file, rows);
      return res.status(200).json({ ok: true, total: rows.length, item: newRow });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
