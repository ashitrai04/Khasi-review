import { Storage } from "@google-cloud/storage";
import { readFileSync } from "fs";
import { resolve } from "path";

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  try {
    const gsPath = req.query.path;

    if (!gsPath || !gsPath.startsWith("gs://")) {
      res.statusCode = 400;
      res.end("Missing or invalid ?path=gs://...");
      return;
    }

    const withoutPrefix = gsPath.slice(5); // remove "gs://"
    const slashIdx = withoutPrefix.indexOf("/");
    const bucket = withoutPrefix.slice(0, slashIdx);
    const objPath = withoutPrefix.slice(slashIdx + 1);

    const storage = getStorageClient();
    const file = storage.bucket(bucket).file(objPath);

    const [exists] = await file.exists();
    if (!exists) {
      res.statusCode = 404;
      res.end("File not found");
      return;
    }

    const [metadata] = await file.getMetadata();
    const ext = objPath.split('.').pop().toLowerCase();
    const contentType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';

    res.writeHead(200, {
      'Content-Type': metadata.contentType || contentType,
      'Content-Length': metadata.size,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });

    const readStream = file.createReadStream();
    readStream.on('error', (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Stream error");
      }
    });

    readStream.pipe(res);
  } catch (err) {
    console.error("GCS audio proxy API error:", err?.message || err);
    res.statusCode = 500;
    res.end(String(err?.message || err));
  }
}
