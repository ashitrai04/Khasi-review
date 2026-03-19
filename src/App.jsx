import { useEffect, useMemo, useState } from "react";

const REVIEW_STORAGE_KEY = "khasi_asr_review_v2";
const REVIEWER_STORAGE_KEY = "khasi_asr_reviewer_name";
const ADMIN_SESSION_KEY = "khasi_admin_authed";
const ADMIN_USER = "Ashit";
const ADMIN_PASS = "Ashit@123";

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
    reviewer_name: it.reviewer_name || "",
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
  const [reviewerName, setReviewerName] = useState(() => localStorage.getItem(REVIEWER_STORAGE_KEY) || "");
  const [viewMode, setViewMode] = useState("review");
  const [importedRows, setImportedRows] = useState([]);
  const [adminMsg, setAdminMsg] = useState("Admin view ready. Load cloud CSV or import reviewer JSON files.");
  const [cloudMsg, setCloudMsg] = useState("Cloud save idle.");
  const [isSaving, setIsSaving] = useState(false);
  const [adminUserInput, setAdminUserInput] = useState("");
  const [adminPassInput, setAdminPassInput] = useState("");
  const [adminAuthMsg, setAdminAuthMsg] = useState("");
  const [isAdminAuthed, setIsAdminAuthed] = useState(() => sessionStorage.getItem(ADMIN_SESSION_KEY) === "1");

  const [isRegistered, setIsRegistered] = useState(() => !!localStorage.getItem(REVIEWER_STORAGE_KEY));
  const [regName, setRegName] = useState("");
  const [regGender, setRegGender] = useState("");
  const [regLocation, setRegLocation] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  function handleRegister(e) {
    e.preventDefault();
    if (!regName.trim()) return;
    const combined = `${regName.trim()} | ${regGender} | ${regLocation.trim()}`.replace(/\|\s*\|/g, "|").trim();
    setReviewerName(combined.replace(/\|\s*$/, ""));
    setIsRegistered(true);
  }


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

  useEffect(() => {
    localStorage.setItem(REVIEWER_STORAGE_KEY, reviewerName);
  }, [reviewerName]);

  useEffect(() => {
    if (isAdminAuthed) sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
    else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }, [isAdminAuthed]);

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
  const canCloudSave = reviewerName.trim().length > 0;

  async function saveReviewToCloud(item, reviewData) {
    const name = reviewerName.trim();
    if (!name) {
      setCloudMsg("Enter reviewer name before saving to cloud.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer_name: name,
          chunk_id: item.chunk_id,
          verdict: reviewData.verdict || "",
          reviewer_note: reviewData.reviewer_note || "",
          corrected_text: reviewData.corrected_text || "",
          transcript: item.transcript || "",
          audio_url: item.audio_url || "",
          source_audio: item.source_audio || "",
          duration_sec: item.duration_sec || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCloudMsg(`Saved to cloud CSV for ${item.chunk_id}.`);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      setCloudMsg(`Cloud save failed: ${err}`);
    } finally {
      setIsSaving(false);
    }
  }

  function applyReviewPatch(chunkId, patch, autoSave = false) {
    const item = items.find((it) => it.chunk_id === chunkId);
    const base = reviews[chunkId] || {};
    const nextReview = {
      ...base,
      ...patch,
      reviewed_at: new Date().toISOString(),
    };

    setReviews((prev) => ({
      ...prev,
      [chunkId]: nextReview,
    }));

    if (autoSave && item) {
      void saveReviewToCloud(item, nextReview);
    }
  }

  async function saveCurrentSelectionToCloud() {
    if (!selected) return;
    const reviewData = reviews[selected.chunk_id] || {};
    await saveReviewToCloud(selected, reviewData);
  }

  function exportReviewsJson() {
    const rows = items.map((it) => ({
      chunk_id: it.chunk_id,
      reviewer_name: reviewerName,
      transcript: it.transcript,
      audio_url: it.audio_url,
      ...((reviews[it.chunk_id] || {})),
    }));
    downloadFile(
      "khasi_review_results.json",
      JSON.stringify({ count: rows.length, items: rows }, null, 2),
      "application/json"
    );
  }

  function exportReviewsCsv() {
    const rows = items.map((it) => ({
      chunk_id: it.chunk_id,
      reviewer_name: reviewerName,
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
      reviewer_name: reviewerName,
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

  async function loadCloudRowsToAdmin() {
    try {
      const res = await fetch("/api/reviews", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const rows = normalizeReviewRows(data);
      setImportedRows(rows);
      setAdminMsg(`Loaded ${rows.length} rows from cloud CSV.`);
    } catch (err) {
      setAdminMsg(`Cloud load failed: ${err}`);
    }
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
        // keep processing remaining files
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

  function handleAdminLogin(event) {
    event.preventDefault();
    if (adminUserInput === ADMIN_USER && adminPassInput === ADMIN_PASS) {
      setIsAdminAuthed(true);
      setAdminAuthMsg("");
      setAdminPassInput("");
      return;
    }
    setAdminAuthMsg("Invalid admin ID or password.");
  }

  function handleAdminLogout() {
    setIsAdminAuthed(false);
    setImportedRows([]);
    setAdminAuthMsg("");
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🎙️ Khasi ASR Native Review System</h1>
        <p>Hear each audio, read transcript in parallel, and submit reviews into cloud CSV (Autosaved)</p>
      </div>

      <section className="mode-switch">
        <button
          className={viewMode === "review" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setViewMode("review")}
        >
          Reviewer
        </button>
        <button
          className={viewMode === "admin" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setViewMode("admin")}
        >
          Admin
        </button>
      </section>

      {viewMode === "admin" ? (
        <main className="admin-grid">
          {!isAdminAuthed ? (
            <section className="card admin-login-card">
              <h2>Admin Login</h2>
              <p className="status">Use admin ID and password to open the admin side.</p>
              <form className="admin-login-form" onSubmit={handleAdminLogin}>
                <input
                  className="input"
                  value={adminUserInput}
                  onChange={(e) => setAdminUserInput(e.target.value)}
                  placeholder="Admin ID"
                />
                <input
                  className="input"
                  type="password"
                  value={adminPassInput}
                  onChange={(e) => setAdminPassInput(e.target.value)}
                  placeholder="Password"
                />
                <button className="btn btn-primary" type="submit">
                  Login
                </button>
              </form>
              {adminAuthMsg ? <p className="admin-error">{adminAuthMsg}</p> : null}
            </section>
          ) : (
            <>
              <section className="card">
                <h2>Admin Dashboard</h2>
                <p className="status">{adminMsg}</p>
                <div className="actions" style={{marginBottom: 12}}>
                  <button className="btn btn-primary" onClick={loadCloudRowsToAdmin}>Load Cloud CSV</button>
                  <button className="btn btn-ghost" onClick={loadCurrentRowsToAdmin}>Load Browser Reviews</button>
                  <button className="btn btn-ghost"
                    onClick={() =>
                      downloadFile("admin_merged_reviews.csv", toCsv(importedRows), "text/csv;charset=utf-8")
                    }
                  >
                    Export Admin CSV
                  </button>
                  <button className="btn btn-ghost"
                    onClick={() =>
                      downloadFile(
                        "admin_merged_reviews.json",
                        JSON.stringify({ count: importedRows.length, items: importedRows }, null, 2),
                        "application/json"
                      )
                    }
                  >
                    Export Admin JSON
                  </button>
                  <button className="btn btn-danger" onClick={handleAdminLogout}>Logout</button>
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
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Reviewer Name</th>
                        <th>Chunk ID</th>
                        <th>Verdict</th>
                        <th>Corrected Text</th>
                        <th>Note</th>
                        <th>Reviewed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedRows.map((row, idx) => (
                        <tr key={`${row.reviewer_name}-${row.chunk_id}-${idx}`}>
                          <td>{row.reviewer_name || ""}</td>
                          <td>{row.chunk_id}</td>
                          <td>{row.verdict || "pending"}</td>
                          <td>{row.corrected_text || ""}</td>
                          <td>{row.reviewer_note || ""}</td>
                          <td>{row.reviewed_at || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </main>
      ) : !isRegistered ? (
        <main className="grid" style={{display: "block"}}>
          <div className="card" style={{maxWidth: 500, margin: "0 auto"}}>
            <div className="card-title">👤 Reviewer Details</div>
            <form onSubmit={handleRegister} className="form-grid">
              <div className="full">
                <label className="form-label">Full Name *</label>
                <input className="input" value={regName} onChange={(e) => setRegName(e.target.value)} required placeholder="Enter your name" />
              </div>
              <div>
                <label className="form-label">Gender</label>
                <select className="input" value={regGender} onChange={(e) => setRegGender(e.target.value)}>
                  <option value="">Select</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="full">
                <label className="form-label">Location</label>
                <input className="input" value={regLocation} onChange={(e) => setRegLocation(e.target.value)} placeholder="Village / Town / City" />
              </div>
              <div className="full" style={{marginTop: 10}}>
                <button type="submit" className="btn btn-primary" style={{width: "100%", justifyContent: "center"}}>Start Reviewing →</button>
              </div>
            </form>
          </div>
        </main>
      ) : (
        <>
          <section className="card filter-bar controls">
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by chunk id or transcript text"
              style={{flex: 1}}
            />
            <div className="actions">
              <button className="btn btn-ghost" onClick={exportReviewsJson}>Export JSON</button>
              <button className="btn btn-ghost" onClick={exportReviewsCsv}>Export CSV</button>
            </div>
            <div className="status" style={{gridColumn: "1 / -1", textAlign: "left", margin: 0}}>{loadMsg}</div>
            <div className="status" style={{gridColumn: "1 / -1", textAlign: "left", margin: 0}}>{cloudMsg}</div>
            {!canCloudSave ? (
              <div className="status error" style={{gridColumn: "1 / -1", textAlign: "left", margin: 0}}>Enter reviewer name first, then cloud save will work.</div>
            ) : null}
            <div className="progress-row bulk-bar" style={{gridColumn: "1 / -1", margin: 0}}>
              <span>Reviewed: {reviewedCount}/{items.length}</span>
              <span style={{color: "var(--green)"}}>✅ Correct: {correctCount}</span>
              <span style={{color: "var(--red)"}}>❌ Incorrect: {incorrectCount}</span>
              <span style={{color: "var(--orange)"}}>🤔 Unsure: {unsureCount}</span>
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
                        <small className={`badge ${verdict || "pending"}`}>{verdict || "pending"}</small>
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
                      className={`btn ${selectedReview.verdict === "correct" ? "btn-success" : "btn-ghost"}`}
                      onClick={() => applyReviewPatch(selected.chunk_id, { verdict: "correct" }, true)}
                      disabled={!canCloudSave || isSaving}
                    >
                      Correct
                    </button>
                    <button
                      className={`btn ${selectedReview.verdict === "incorrect" ? "btn-danger" : "btn-ghost"}`}
                      onClick={() => applyReviewPatch(selected.chunk_id, { verdict: "incorrect" }, true)}
                      disabled={!canCloudSave || isSaving}
                    >
                      Incorrect
                    </button>
                    <button
                      className={`btn ${selectedReview.verdict === "unsure" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => applyReviewPatch(selected.chunk_id, { verdict: "unsure" }, true)}
                      disabled={!canCloudSave || isSaving}
                    >
                      Unsure
                    </button>
                    <button className="btn btn-primary" onClick={saveCurrentSelectionToCloud} disabled={!canCloudSave || isSaving} style={{marginLeft: "auto"}}>
                      {isSaving ? "Submitting..." : "Submit"}
                    </button>
                  </div>

                  <label className="field-label">Corrected transcript (if needed)</label>
                  <textarea
                    className="text-area"
                    value={selectedReview.corrected_text || ""}
                    onChange={(e) =>
                      applyReviewPatch(selected.chunk_id, {
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
                      applyReviewPatch(selected.chunk_id, {
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

      <footer className="company-footer">
        © 2026 Yantrikaran Innovations Private Limited
      </footer>

      <div className={`success-overlay ${showSuccess ? "show" : ""}`}>
        <div className="success-box">
          <div className="check">✅</div>
          <h2>Submitted Successfully!</h2>
          <p style={{fontStyle: "italic", margin: "14px 0", color: "var(--accent)", lineHeight: 1.5}}>
            "Ka Ktien Khasi ka long ka spah ba kordor jong ngi."<br/>
            <span style={{fontSize: "0.85rem", opacity: 0.8}}>(The Khasi language is our precious wealth)</span>
          </p>
          <p style={{fontSize: "0.85rem", color: "var(--muted)"}}>
            Thank you from Yantrikaran Innovations
          </p>
        </div>
      </div>
    </div>
  );
}
