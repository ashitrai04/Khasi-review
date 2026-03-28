import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { Storage } from "@google-cloud/storage";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

// Load .env
config();

function gcsAudioProxy() {
  let storage;

  function getStorage() {
    if (storage) return storage;

    // Try service account key from .env first
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (keyJson) {
      let creds = JSON.parse(keyJson);
      if (typeof creds === "string") creds = JSON.parse(creds);
      if (typeof creds.private_key === "string") {
        creds.private_key = creds.private_key.replace(/\\n/g, "\n").trim();
      }
      storage = new Storage({
        projectId: creds.project_id,
        credentials: creds,
      });
      return storage;
    }

    // Fallback: try JSON key file in project root
    const keyFiles = [
      "gen-lang-client-0265159915-95f315dccce0.json",
      "gen-lang-client-0265159915-43b71baad8d0.json",
    ];
    for (const f of keyFiles) {
      try {
        const fullPath = resolve(process.cwd(), f);
        const creds = JSON.parse(readFileSync(fullPath, "utf-8"));
        if (typeof creds.private_key === "string") {
          creds.private_key = creds.private_key.replace(/\\n/g, "\n").trim();
        }
        storage = new Storage({
          projectId: creds.project_id,
          credentials: creds,
        });
        return storage;
      } catch {
        // try next
      }
    }

    storage = new Storage();
    return storage;
  }

  return {
    name: "gcs-audio-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Handle /api/audio?path=gs://bucket/object
        if (!req.url?.startsWith("/api/audio")) return next();

        try {
          const url = new URL(req.url, "http://localhost");
          const gsPath = url.searchParams.get("path");

          if (!gsPath || !gsPath.startsWith("gs://")) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing or invalid ?path=gs://..." }));
            return;
          }

          const withoutPrefix = gsPath.slice(5); // remove "gs://"
          const slashIdx = withoutPrefix.indexOf("/");
          const bucket = withoutPrefix.slice(0, slashIdx);
          const objPath = withoutPrefix.slice(slashIdx + 1);

          const client = getStorage();
          const file = client.bucket(bucket).file(objPath);

          const [exists] = await file.exists();
          if (!exists) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "File not found" }));
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
          console.error("GCS audio proxy error:", err?.message || err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), gcsAudioProxy()],
});
