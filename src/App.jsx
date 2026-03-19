import { useEffect, useMemo, useState } from "react";

const REVIEW_STORAGE_KEY = "khasi_asr_review_v1";

function loadStoredReviews() {
  try {
    const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function downloadFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll("\"", "\"\"")}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(","));
  }
  return lines.join("\n");
}

function normalizeReviewRows(raw) {
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return items.map((it) => ({
    chunk_id: it.chunk_id || "",
    verdict: it.verdict || "",
    reviewer_note: it.reviewer_note || "",
    corrected_text: it.corrected_text || "",
    reviewed_at: it.reviewed_at || "",
    transcript: it.transcript || "",
    audio_url: it.audio_url || "",
  }));
}

export default function App() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loadMsg, setLoadMsg] = useState("Loading 50-audio Khasi review set...");
  const [reviews, setReviews] = useState(() => loadStoredReviews());
  const [viewMode, setViewMode] = useState("review");
  const [importedRows, setImportedRows] = useState([]);
  const [adminMsg, setAdminMsg] = useState("Admin view is ready. Import reviewer JSON files to inspect results.");

  useEffect(() => {
    async function loadReviewSet() {
      try {
        const res = await fetch("/review/review_items.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const nextItems = Array.isArray(payload.items) ? payload.items : [];
        setItems(nextItems);
        setSelectedId(nextItems[0]?.chunk_id || "");
        setLoadMsg(`Loaded ${nextItems.length} audio chunks for review.`);
      } catch (err) {
        setLoadMsg(`Failed to load review set: ${err}`);
      }
    }

    loadReviewSet();
  }, []);

  useEffect(() => {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews));
  }, [reviews]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const transcript = (it.transcript || "").toLowerCase();
      const chunkId = (it.chunk_id || "").toLowerCase();
      return transcript.includes(q) || chunkId.includes(q);
    });
  }, [items, query]);

  const selected = useMemo(
    () => items.find((it) => it.chunk_id === selectedId) || filtered[0] || null,
    [items, filtered, selectedId]
  );

  const selectedReview = selected ? reviews[selected.chunk_id] || {} : {};

  const reviewedCount = Object.values(reviews).filter((r) => r.verdict).length;
  const correctCount = Object.values(reviews).filter((r) => r.verdict === "correct").length;
  const incorrectCount = Object.values(reviews).filter((r) => r.verdict === "incorrect").length;
  const unsureCount = Object.values(reviews).filter((r) => r.verdict === "unsure").length;

  function updateReview(chunkId, patch) {
    setReviews((prev) => ({
      ...prev,
      [chunkId]: {
        ...(prev[chunkId] || {}),
        ...patch,
        reviewed_at: new Date().toISOString(),
      },
    }));
  }

  function exportReviewsJson() {
    const rows = items.map((it) => ({
      chunk_id: it.chunk_id,
      transcript: it.transcript,
      audio_url: it.audio_url,
      ...((reviews[it.chunk_id] || {})),
    }));
    downloadFile("khasi_review_results.json", JSON.stringify({ count: rows.length, items: rows }, null, 2), "application/json");
  }

  function exportReviewsCsv() {
    const rows = items.map((it) => ({
      chunk_id: it.chunk_id,
      verdict: reviews[it.chunk_id]?.verdict || "",
      reviewer_note: reviews[it.chunk_id]?.reviewer_note || "",
      corrected_text: reviews[it.chunk_id]?.corrected_text || "",
      reviewed_at: reviews[it.chunk_id]?.reviewed_at || "",
      transcript: it.transcript,
      audio_url: it.audio_url,
      source_audio: it.source_audio || "",
    }));
    downloadFile("khasi_review_results.csv", toCsv(rows), "text/csv;charset=utf-8");
  }

  function loadCurrentRowsToAdmin() {
    const rows = items.map((it) => ({
      chunk_id: it.chunk_id,
      verdict: reviews[it.chunk_id]?.verdict || "",
      reviewer_note: reviews[it.chunk_id]?.reviewer_note || "",
      corrected_text: reviews[it.chunk_id]?.corrected_text || "",
      reviewed_at: reviews[it.chunk_id]?.reviewed_at || "",
      transcript: it.transcript,
      audio_url: it.audio_url,
    }));
    setImportedRows(rows);
    setAdminMsg(`Loaded ${rows.length} rows from current browser reviewer data.`);
  }

  async function importReviewerJsonFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const merged = [];
    for (const f of files) {
      try {
        const text = await f.text();
        const parsed = JSON.parse(text);
        const rows = normalizeReviewRows(parsed);
        for (const row of rows) {
          merged.push({ ...row, source_file: f.name });
        }
      } catch {
        // continue with remaining files
      }
    }

    setImportedRows(merged);
    setAdminMsg(`Imported ${merged.length} rows from ${files.length} file(s).`);
    event.target.value = "";
  }

  const adminStats = useMemo(() => {
    const reviewed = importedRows.filter((r) => r.verdict).length;
    const correct = importedRows.filter((r) => r.verdict === "correct").length;
    const incorrect = importedRows.filter((r) => r.verdict === "incorrect").length;
    const unsure = importedRows.filter((r) => r.verdict === "unsure").length;
    return { reviewed, correct, incorrect, unsure };
  }, [importedRows]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Khasi ASR Native Review System</h1>
        <p>Hear each of the 50 audios, read transcript in parallel, and mark correctness.</p>
      </header>

      <section className="mode-switch card">
        <button className={viewMode === "review" ? "mode-btn active" : "mode-btn"} onClick={() => setViewMode("review")}>Reviewer</button>
        <button className={viewMode === "admin" ? "mode-btn active" : "mode-btn"} onClick={() => setViewMode("admin")}>Admin</button>
      </section>

      {viewMode === "admin" ? (
        <main className="admin-grid">
          <section className="card">
            <h2>Admin Dashboard</h2>
            <p className="status">{adminMsg}</p>
            <div className="actions">
              <button onClick={loadCurrentRowsToAdmin}>Load Current Browser Reviews</button>
              <button onClick={() => downloadFile("admin_merged_reviews.csv", toCsv(importedRows), "text/csv;charset=utf-8")}>Export Admin CSV</button>
              <button onClick={() => downloadFile("admin_merged_reviews.json", JSON.stringify({ count: importedRows.length, items: importedRows }, null, 2), "application/json")}>Export Admin JSON</button>
            </div>
            <label className="field-label">Import reviewer JSON file(s)</label>
            <input type="file" accept="application/json" multiple onChange={importReviewerJsonFiles} />

            <div className="progress-row" style={{ marginTop: 10 }}>
              <span>Total rows: {importedRows.length}</span>
              <span>Reviewed: {adminStats.reviewed}</span>
              <span>✅ Correct: {adminStats.correct}</span>
              <span>❌ Incorrect: {adminStats.incorrect}</span>
              <span>🤔 Unsure: {adminStats.unsure}</span>
            </div>
          </section>

          <section className="card admin-table-wrap">
            <h3>Review Records</h3>
            {importedRows.length === 0 ? (
              <p>No admin rows loaded yet.</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>chunk_id</th>
                    <th>verdict</th>
                    <th>corrected_text</th>
                    <th>note</th>
                    <th>source_file</th>
                  </tr>
                </thead>
                <tbody>
                  {importedRows.map((row, idx) => (
                    <tr key={`${row.chunk_id}-${idx}`}>
                      <td>{row.chunk_id}</td>
                      <td>{row.verdict || "pending"}</td>
                      <td>{row.corrected_text || ""}</td>
                      <td>{row.reviewer_note || ""}</td>
                      <td>{row.source_file || "local"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      ) : (
      <>

      <section className="controls card">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by chunk id or transcript text"
        />
        <div className="actions">
          <button onClick={exportReviewsJson}>Export JSON</button>
          <button onClick={exportReviewsCsv}>Export CSV</button>
        </div>
        <div className="status">{loadMsg}</div>
        <div className="progress-row">
          <span>Reviewed: {reviewedCount}/{items.length}</span>
          <span>✅ Correct: {correctCount}</span>
          <span>❌ Incorrect: {incorrectCount}</span>
          <span>🤔 Unsure: {unsureCount}</span>
        </div>
      </section>

      <main className="grid">
        <aside className="list card">
          <h2>Chunks ({filtered.length})</h2>
          <ul>
            {filtered.map((item, i) => {
              const verdict = reviews[item.chunk_id]?.verdict || "";
              return (
                <li key={`${item.chunk_id}-${i}`}>
                  <button
                    className={item.chunk_id === selected?.chunk_id ? "active" : ""}
                    onClick={() => setSelectedId(item.chunk_id)}
                  >
                    <span>
                      <strong>{item.chunk_id || `item-${i + 1}`}</strong>
                      <small>{item.duration_sec ? `${item.duration_sec}s` : ""}</small>
                    </span>
                    <small className={`badge ${verdict || "pending"}`}>
                      {verdict || "pending"}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="viewer card">
          {!selected ? (
            <p>No item selected.</p>
          ) : (
            <>
              <h2>{selected.chunk_id}</h2>
              <audio controls src={selected.audio_url || ""} preload="metadata" />
              <div className="meta">
                <div>
                  <span>Duration</span>
                  <strong>{selected.duration_sec || "-"}s</strong>
                </div>
                <div>
                  <span>Start</span>
                  <strong>{selected.start_sec || "-"}</strong>
                </div>
                <div>
                  <span>End</span>
                  <strong>{selected.end_sec || "-"}</strong>
                </div>
              </div>
              <h3>Transcript</h3>
              <article className="transcript">{selected.transcript || "(empty transcript)"}</article>

              <h3>Reviewer decision</h3>
              <div className="verdict-row">
                <button
                  className={selectedReview.verdict === "correct" ? "pill active correct" : "pill"}
                  onClick={() => updateReview(selected.chunk_id, { verdict: "correct" })}
                >
                  Correct
                </button>
                <button
                  className={selectedReview.verdict === "incorrect" ? "pill active incorrect" : "pill"}
                  onClick={() => updateReview(selected.chunk_id, { verdict: "incorrect" })}
                >
                  Incorrect
                </button>
                <button
                  className={selectedReview.verdict === "unsure" ? "pill active unsure" : "pill"}
                  onClick={() => updateReview(selected.chunk_id, { verdict: "unsure" })}
                >
                  Unsure
                </button>
              </div>

              <label className="field-label">Corrected transcript (if needed)</label>
              <textarea
                className="text-area"
                value={selectedReview.corrected_text || ""}
                onChange={(e) =>
                  updateReview(selected.chunk_id, {
                    corrected_text: e.target.value,
                  })
                }
                placeholder="Write corrected Khasi text if transcript is wrong"
              />

              <label className="field-label">Reviewer note</label>
              <textarea
                className="text-area"
                value={selectedReview.reviewer_note || ""}
                onChange={(e) =>
                  updateReview(selected.chunk_id, {
                    reviewer_note: e.target.value,
                  })
                }
                placeholder="Optional note: pronunciation, noise, mixed language, etc."
              />
            </>
          )}
        </section>
      </main>
      </>
      )}
    </div>
  );
}
