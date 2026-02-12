"use client";

import { useState, useEffect, useCallback } from "react";

// ── Toast System ──
type ToastType = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}
let toastId = 0;

// ── Confirm Modal ──
interface ConfirmState {
  open: boolean;
  message: string;
  onConfirm: () => void;
}

export default function Home() {
  const [vehicle, setVehicle] = useState("");
  const [price, setPrice] = useState("");
  const [result, setResult] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [scrapingAll, setScrapingAll] = useState(false);
  const [scrapingId, setScrapingId] = useState<number | null>(null);
  const [photoIndex, setPhotoIndex] = useState<Record<number, number>>({});
  const [expandedDesc, setExpandedDesc] = useState<Record<number, boolean>>({});
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const [postingStatus, setPostingStatus] = useState<{
    daily: { count: number; limit: number };
    queue: number;
    totalPosted: number;
  }>({ daily: { count: 0, limit: 10 }, queue: 0, totalPosted: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmModal, setConfirmModal] = useState<ConfirmState>({
    open: false,
    message: "",
    onConfirm: () => {},
  });

  // Toast helpers
  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Confirm helper
  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmModal({ open: true, message, onConfirm });
  };

  const handleConfirm = () => {
    confirmModal.onConfirm();
    setConfirmModal({ open: false, message: "", onConfirm: () => {} });
  };

  const handleCancel = () => {
    setConfirmModal({ open: false, message: "", onConfirm: () => {} });
  };

  // Fetch Vehicles
  const fetchVehicles = async () => {
    const res = await fetch("/api/vehicles");
    const data = await res.json();
    setVehicles(Array.isArray(data) ? data : []);
  };

  // Fetch posting status
  const fetchPostingStatus = async () => {
    try {
      const res = await fetch("/api/posting-status");
      const data = await res.json();
      if (!data.error) {
        setPostingStatus({
          daily: data.daily || { count: 0, limit: 10 },
          queue: data.queue || 0,
          totalPosted: data.totalPosted || 0,
        });
      }
    } catch {}
  };

  useEffect(() => {
    fetchVehicles();
    fetchPostingStatus();
    const saved = localStorage.getItem("lastVAutoUpload");
    if (saved) setLastUpload(saved);
    // Refresh posting status every 30 seconds
    const interval = setInterval(fetchPostingStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const daysSinceUpload = lastUpload
    ? Math.floor(
        (Date.now() - new Date(lastUpload).getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;
  const showReminder = daysSinceUpload === null || daysSinceUpload >= 3;

  // Generate Single Post
  const generatePost = async () => {
    if (!vehicle || !price) {
      showToast("Enter vehicle and price", "error");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicle, price }),
    });
    const data = await res.json();
    setResult(data.result);
    setLoading(false);
    showToast("Post generated", "success");
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    showToast("Copied to clipboard", "success");
  };

  // Upload PDF
  const handlePDFUpload = async () => {
    if (!pdfFile) {
      showToast("Please select a file first", "error");
      return;
    }
    setUploadProgress("Uploading and parsing PDF...");
    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      const res = await fetch("/api/upload-pdf", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
        setUploadProgress("");
        return; // Keep file selected so user can retry
      }
      const now = new Date().toISOString();
      localStorage.setItem("lastVAutoUpload", now);
      setLastUpload(now);
      showToast(
        `Synced: +${data.added || 0} new, ${data.updated || 0} updated, -${data.removed || 0} sold`,
        "success"
      );
      fetchVehicles();
    } catch (err) {
      console.error(err);
      showToast("Upload failed — try again", "error");
      setUploadProgress("");
      return; // Keep file selected so user can retry
    }
    setUploadProgress("");
    setPdfFile(null);
  };

  // Delete All
  const deleteAllInventory = () => {
    showConfirm("Delete ALL inventory and descriptions?", async () => {
      const res = await fetch("/api/delete-all", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else {
        showToast("All inventory deleted", "success");
        fetchVehicles();
      }
    });
  };

  // Generate Description
  const generateDescriptionForVehicle = async (id: number) => {
    setLoading(true);
    const res = await fetch("/api/generate-from-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
    } else {
      showToast("Description generated", "success");
      fetchVehicles();
    }
    setLoading(false);
  };

  // Scrape photos + auto-generate description for a single vehicle
  const scrapePhotos = async (id: number, vin: string) => {
    setScrapingId(id);
    try {
      const res = await fetch("/api/scrape-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: id, vin }),
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else {
        const parts = [`${data.photosFound} photos`];
        if (data.descriptionGenerated) parts.push("+ description");
        showToast(parts.join(" "), "success");
        fetchVehicles();
      }
    } catch (err) {
      console.error(err);
      showToast("Photo scraping failed", "error");
    }
    setScrapingId(null);
  };

  // Scrape photos + generate descriptions for ALL vehicles
  const scrapeAllPhotos = async () => {
    setScrapingAll(true);
    showToast("Scraping photos & generating descriptions...", "info");
    try {
      const res = await fetch("/api/scrape-all-photos", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else if (data.stopped) {
        showToast(
          `Stopped — ${data.photosScraped} photos, ${data.descriptionsGenerated} descriptions`,
          "info"
        );
        fetchVehicles();
      } else {
        showToast(
          `Done — ${data.photosScraped} photos, ${data.descriptionsGenerated} descriptions`,
          "success"
        );
        fetchVehicles();
      }
    } catch (err) {
      console.error(err);
      showToast("Bulk processing failed", "error");
    }
    setScrapingAll(false);
  };

  // Stop scraping
  const stopScraping = async () => {
    await fetch("/api/stop-scraping", { method: "POST" });
    showToast("Stopping after current vehicle...", "info");
  };

  // Delete a single vehicle
  const deleteVehicle = (id: number) => {
    showConfirm("Delete this vehicle and its photos?", async () => {
      const res = await fetch("/api/delete-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else {
        showToast("Vehicle deleted", "success");
        fetchVehicles();
      }
    });
  };

  // Queue vehicle for FB posting
  const queueForPosting = async (id: number) => {
    const res = await fetch("/api/queue-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId: id }),
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
    } else {
      showToast("Added to posting queue", "success");
      fetchVehicles();
      fetchPostingStatus();
    }
  };

  // Remove from queue
  const unqueuePost = async (id: number) => {
    const res = await fetch("/api/unqueue-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId: id }),
    });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
    } else {
      showToast("Removed from queue", "info");
      fetchVehicles();
      fetchPostingStatus();
    }
  };

  // Queue all ready vehicles
  const queueAllReady = async () => {
    const res = await fetch("/api/queue-all", { method: "POST" });
    const data = await res.json();
    if (data.error) {
      showToast(data.error, "error");
    } else {
      showToast(`${data.queued} vehicles queued`, "success");
      fetchVehicles();
      fetchPostingStatus();
    }
  };

  // Photo navigation
  const nextPhoto = (id: number, total: number) => {
    setPhotoIndex((prev) => ({
      ...prev,
      [id]: ((prev[id] || 0) + 1) % total,
    }));
  };
  const prevPhoto = (id: number, total: number) => {
    setPhotoIndex((prev) => ({
      ...prev,
      [id]: ((prev[id] || 0) - 1 + total) % total,
    }));
  };

  return (
    <div style={styles.page}>
      {/* ── Toast Container ── */}
      <div style={styles.toastContainer}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              ...styles.toast,
              ...(t.type === "success"
                ? styles.toastSuccess
                : t.type === "error"
                ? styles.toastError
                : styles.toastInfo),
            }}
            onClick={() => dismissToast(t.id)}
          >
            <span style={styles.toastIcon}>
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* ── Confirm Modal ── */}
      {confirmModal.open && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <p style={styles.modalText}>{confirmModal.message}</p>
            <div style={styles.modalButtons}>
              <button style={styles.modalCancel} onClick={handleCancel}>
                Cancel
              </button>
              <button style={styles.modalConfirm} onClick={handleConfirm}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.logo}>FB Marketplace Tool</h1>
          <div style={styles.headerRight}>
            <span style={styles.vehicleCount}>
              {vehicles.length} vehicles
            </span>
            <span style={styles.postingCounter}>
              {postingStatus.daily.count}/{postingStatus.daily.limit} today
              {postingStatus.queue > 0 && ` | ${postingStatus.queue} queued`}
            </span>
            <a href="/dashboard" style={styles.btnHeaderAction}>
              Dashboard
            </a>
            <button style={styles.btnHeaderAction} onClick={queueAllReady}>
              Queue All
            </button>
            {scrapingAll ? (
              <button style={styles.btnHeaderDanger} onClick={stopScraping}>
                Stop Scraping
              </button>
            ) : (
              <button
                style={styles.btnHeaderAction}
                onClick={scrapeAllPhotos}
              >
                Scrape & Generate
              </button>
            )}
            <button
              style={styles.toolsToggle}
              onClick={() => setShowTools(!showTools)}
            >
              {showTools ? "Close Tools" : "Tools"}
            </button>
          </div>
        </div>
      </header>

      {/* Reminder Banner */}
      {showReminder && (
        <div style={styles.reminderBanner}>
          <div style={styles.reminderInner}>
            <span style={styles.reminderText}>
              {daysSinceUpload === null
                ? "You haven't uploaded a vAuto report yet. Upload one to get started."
                : `It's been ${daysSinceUpload} days since your last inventory sync. Upload a fresh vAuto report to keep your listings current.`}
            </span>
            <button
              style={styles.reminderBtn}
              onClick={() => setShowTools(true)}
            >
              Upload Now
            </button>
          </div>
        </div>
      )}

      {/* Tools Panel */}
      {showTools && (
        <div style={styles.toolsPanel}>
          <div style={styles.toolsGrid}>
            <div style={styles.toolCard}>
              <h3 style={styles.toolTitle}>Generate Single Post</h3>
              <input
                style={styles.input}
                placeholder="Vehicle (e.g. 2022 GMC Sierra)"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
              />
              <input
                style={styles.input}
                placeholder="Price (e.g. 22,500)"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <button style={styles.btnPrimary} onClick={generatePost}>
                {loading ? "Generating..." : "Generate"}
              </button>
              {result && (
                <div style={styles.resultBox}>
                  <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "13px" }}>
                    {result}
                  </pre>
                  <button style={styles.btnSmall} onClick={copyToClipboard}>
                    Copy
                  </button>
                </div>
              )}
            </div>

            <div style={styles.toolCard}>
              <h3 style={styles.toolTitle}>Upload vAuto PDF</h3>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                style={styles.fileInput}
              />
              {pdfFile && (
                <p style={styles.fileInfo}>
                  {pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)
                </p>
              )}
              <button
                style={styles.btnPrimary}
                onClick={handlePDFUpload}
                disabled={!pdfFile}
              >
                {uploadProgress || "Upload & Parse"}
              </button>
              <button style={styles.btnDanger} onClick={deleteAllInventory}>
                Delete All Inventory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Grid */}
      <main style={styles.main}>
        {vehicles.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={{ fontSize: "18px", fontWeight: 600 }}>No vehicles yet</p>
            <p style={{ color: "#999", marginTop: "8px" }}>
              Upload a vAuto PDF to get started
            </p>
          </div>
        ) : (
          <div style={styles.grid}>
            {vehicles.map((v) => {
              const photos: string[] = v.photos || [];
              const currentIdx = photoIndex[v.id] || 0;

              return (
                <div key={v.id} style={styles.tile}>
                  {photos.length > 0 ? (
                    <div style={styles.photoContainer}>
                      <img
                        src={photos[currentIdx]}
                        alt={`${v.year} ${v.make} ${v.model}`}
                        style={styles.vehiclePhoto}
                      />
                      {photos.length > 1 && (
                        <>
                          <button
                            style={{ ...styles.photoNav, left: "8px" }}
                            onClick={() => prevPhoto(v.id, photos.length)}
                          >
                            &#8249;
                          </button>
                          <button
                            style={{ ...styles.photoNav, right: "8px" }}
                            onClick={() => nextPhoto(v.id, photos.length)}
                          >
                            &#8250;
                          </button>
                          <span style={styles.photoCounter}>
                            {currentIdx + 1}/{photos.length}
                          </span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div
                      style={styles.imagePlaceholder}
                      onClick={() => v.vin && scrapePhotos(v.id, v.vin)}
                      title="Click to scrape photos"
                    >
                      {scrapingId === v.id ? (
                        <span style={styles.placeholderText}>Scraping...</span>
                      ) : (
                        <span style={styles.placeholderText}>
                          Click to load photos
                        </span>
                      )}
                    </div>
                  )}

                  <div style={styles.tileBody}>
                    <div style={styles.tileTopRow}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(v.fb_status === "posted"
                            ? styles.statusPosted
                            : v.fb_status === "queued"
                            ? styles.statusQueued
                            : v.fb_status === "posting"
                            ? styles.statusPosting
                            : v.fb_status === "failed"
                            ? styles.statusFailed
                            : styles.statusNotPosted),
                        }}
                      >
                        {v.fb_status === "posted"
                          ? "Posted"
                          : v.fb_status === "queued"
                          ? "Queued"
                          : v.fb_status === "posting"
                          ? "Posting..."
                          : v.fb_status === "failed"
                          ? "Failed"
                          : "Not Posted"}
                      </span>
                      <button
                        style={styles.deleteBtn}
                        onClick={() => deleteVehicle(v.id)}
                        title="Delete vehicle"
                      >
                        ✕
                      </button>
                    </div>
                    <h3 style={styles.vehicleName}>
                      {v.year} {v.make} {v.model} {v.trim}
                    </h3>

                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>VIN</span>
                      <span style={styles.detailValue}>{v.vin || "N/A"}</span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Mileage</span>
                      <span style={styles.detailValue}>
                        {v.mileage
                          ? `${Number(v.mileage).toLocaleString()} mi`
                          : "N/A"}
                      </span>
                    </div>

                    <div style={styles.priceSection}>
                      <span style={styles.price}>
                        {v.price && Number(v.price) > 0
                          ? `$${Number(v.price).toLocaleString()}`
                          : "Call for Price"}
                      </span>
                    </div>

                    <div style={styles.actions}>
                      {/* Queue / Unqueue button */}
                      {v.fb_status === "queued" ? (
                        <button
                          style={styles.btnQueuedOutline}
                          onClick={() => unqueuePost(v.id)}
                        >
                          Remove from Queue
                        </button>
                      ) : v.fb_status === "posted" ? (
                        <button style={styles.btnPostedDisabled} disabled>
                          Posted to FB
                        </button>
                      ) : v.fb_status === "posting" ? (
                        <button style={styles.btnPostingDisabled} disabled>
                          Posting...
                        </button>
                      ) : v.photos?.length > 0 && v.description_a ? (
                        <button
                          style={styles.btnAction}
                          onClick={() => queueForPosting(v.id)}
                        >
                          Queue for Posting
                        </button>
                      ) : (
                        <button style={styles.btnDisabled} disabled>
                          {!v.photos?.length ? "Needs photos" : "Needs description"}
                        </button>
                      )}
                      <button
                        style={styles.btnActionOutline}
                        onClick={() =>
                          window.open(
                            `https://www.newbybuick.com/searchused.aspx?vin=${v.vin}`,
                            "_blank"
                          )
                        }
                      >
                        View on Website
                      </button>
                    </div>

                    {v.description_a && (
                      <div style={styles.descriptionDropdown}>
                        <button
                          style={styles.descriptionToggle}
                          onClick={() =>
                            setExpandedDesc((prev) => ({
                              ...prev,
                              [v.id]: !prev[v.id],
                            }))
                          }
                        >
                          <span style={styles.descriptionToggleLabel}>
                            Description
                          </span>
                          <span
                            style={{
                              ...styles.descriptionArrow,
                              transform: expandedDesc[v.id]
                                ? "rotate(180deg)"
                                : "rotate(0deg)",
                            }}
                          >
                            &#9662;
                          </span>
                        </button>
                        {expandedDesc[v.id] && (
                          <div style={styles.descriptionContent}>
                            <p style={styles.descriptionText}>
                              {v.description_a}
                            </p>
                            <button
                              style={styles.copyDescBtn}
                              onClick={() => {
                                navigator.clipboard.writeText(v.description_a);
                                showToast("Description copied", "success");
                              }}
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Styles ──
const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#fff",
    minHeight: "100vh",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#111",
  },

  // Toast
  toastContainer: {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxWidth: "380px",
  },
  toast: {
    padding: "14px 18px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
    animation: "slideIn 0.25s ease-out",
    lineHeight: "1.4",
  },
  toastSuccess: {
    background: "#111",
    color: "#fff",
  },
  toastError: {
    background: "#dc2626",
    color: "#fff",
  },
  toastInfo: {
    background: "#fff",
    color: "#111",
    border: "1px solid #e5e5e5",
  },
  toastIcon: {
    fontSize: "16px",
    fontWeight: 700,
    flexShrink: 0,
    width: "20px",
    height: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // Confirm Modal
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.4)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
  },
  modal: {
    background: "#fff",
    borderRadius: "12px",
    padding: "28px",
    maxWidth: "400px",
    width: "90%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalText: {
    fontSize: "16px",
    fontWeight: 500,
    margin: "0 0 24px 0",
    lineHeight: "1.5",
    color: "#111",
  },
  modalButtons: {
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end",
  },
  modalCancel: {
    padding: "10px 20px",
    borderRadius: "6px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#666",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
  },
  modalConfirm: {
    padding: "10px 20px",
    borderRadius: "6px",
    border: "none",
    background: "#dc2626",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },

  // Header
  header: {
    borderBottom: "1px solid #e5e5e5",
    padding: "16px 24px",
    position: "sticky" as const,
    top: 0,
    background: "#fff",
    zIndex: 100,
  },
  headerInner: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logo: { fontSize: "20px", fontWeight: 700, margin: 0, letterSpacing: "-0.5px" },
  headerRight: { display: "flex", alignItems: "center", gap: "12px" },
  vehicleCount: { fontSize: "14px", color: "#666" },
  postingCounter: {
    fontSize: "12px",
    color: "#666",
    background: "#f5f5f5",
    padding: "4px 10px",
    borderRadius: "4px",
    fontWeight: 500,
    fontFamily: "monospace",
  },
  btnHeaderAction: {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#111",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    textDecoration: "none",
  },
  btnHeaderDanger: {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #dc2626",
    background: "#dc2626",
    color: "#fff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
  },
  toolsToggle: {
    padding: "8px 20px",
    borderRadius: "6px",
    border: "1px solid #222",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
  },

  // Reminder
  reminderBanner: { background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "12px 24px" },
  reminderInner: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
  },
  reminderText: { fontSize: "14px", color: "#92400e", fontWeight: 500 },
  reminderBtn: {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #d97706",
    background: "#d97706",
    color: "#fff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },

  // Tools Panel
  toolsPanel: { borderBottom: "1px solid #e5e5e5", padding: "24px", background: "#fafafa" },
  toolsGrid: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "24px",
  },
  toolCard: { background: "#fff", border: "1px solid #e5e5e5", borderRadius: "8px", padding: "20px" },
  toolTitle: { fontSize: "16px", fontWeight: 600, margin: "0 0 16px 0" },
  input: {
    width: "100%",
    padding: "10px 12px",
    marginBottom: "10px",
    borderRadius: "6px",
    border: "1px solid #ddd",
    fontSize: "14px",
    boxSizing: "border-box" as const,
  },
  fileInput: {
    width: "100%",
    padding: "10px",
    marginBottom: "10px",
    borderRadius: "6px",
    border: "1px dashed #ccc",
    fontSize: "14px",
    cursor: "pointer",
    boxSizing: "border-box" as const,
  },
  fileInfo: { fontSize: "13px", color: "#666", margin: "0 0 10px 0" },
  btnPrimary: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#111",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
    marginBottom: "8px",
  },
  btnDanger: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#fff",
    color: "#dc2626",
    border: "1px solid #dc2626",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
  },
  btnSmall: {
    marginTop: "10px",
    padding: "6px 14px",
    borderRadius: "4px",
    background: "#111",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    fontSize: "13px",
  },
  resultBox: {
    background: "#f5f5f5",
    padding: "12px",
    borderRadius: "6px",
    marginTop: "12px",
    border: "1px solid #e5e5e5",
  },

  // Main
  main: { maxWidth: "1400px", margin: "0 auto", padding: "24px" },
  emptyState: { textAlign: "center" as const, padding: "80px 20px", color: "#666" },

  // Grid
  grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" },

  // Tile
  tile: {
    border: "1px solid #e5e5e5",
    borderRadius: "8px",
    overflow: "hidden",
    background: "#fff",
    transition: "box-shadow 0.2s",
  },
  photoContainer: {
    position: "relative" as const,
    height: "200px",
    background: "#000",
    overflow: "hidden",
  },
  vehiclePhoto: { width: "100%", height: "100%", objectFit: "cover" as const },
  photoNav: {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(0,0,0,0.5)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    width: "32px",
    height: "32px",
    fontSize: "20px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  },
  photoCounter: {
    position: "absolute" as const,
    bottom: "8px",
    right: "8px",
    background: "rgba(0,0,0,0.6)",
    color: "#fff",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 500,
  },
  imagePlaceholder: {
    background: "#f5f5f5",
    height: "200px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "1px solid #e5e5e5",
    cursor: "pointer",
  },
  placeholderText: { fontSize: "14px", fontWeight: 500, color: "#bbb" },
  tileBody: { padding: "16px" },
  tileTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  statusBadge: {
    fontSize: "11px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.3px",
  },
  statusNotPosted: { color: "#dc2626", background: "#fef2f2" },
  statusPosted: { color: "#16a34a", background: "#f0fdf4" },
  statusQueued: { color: "#ca8a04", background: "#fefce8" },
  statusPosting: { color: "#2563eb", background: "#eff6ff" },
  statusFailed: { color: "#dc2626", background: "#fef2f2" },
  deleteBtn: {
    background: "none",
    border: "none",
    color: "#ccc",
    cursor: "pointer",
    fontSize: "16px",
    padding: "2px 6px",
    borderRadius: "4px",
    lineHeight: 1,
  },
  vehicleName: {
    fontSize: "15px",
    fontWeight: 700,
    margin: "0 0 12px 0",
    lineHeight: "1.3",
    letterSpacing: "-0.3px",
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "4px 0",
    fontSize: "13px",
    borderBottom: "1px solid #f0f0f0",
  },
  detailLabel: { color: "#999", fontWeight: 500 },
  detailValue: { color: "#333", fontWeight: 500, fontFamily: "monospace", fontSize: "12px" },
  priceSection: {
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: "1px solid #e5e5e5",
    textAlign: "center" as const,
  },
  price: { fontSize: "22px", fontWeight: 800, letterSpacing: "-0.5px" },
  actions: { display: "flex", flexDirection: "column" as const, gap: "8px", marginTop: "16px" },
  btnAction: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#111",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
  },
  btnActionOutline: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#fff",
    color: "#111",
    border: "1px solid #ddd",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
  },
  // Queue buttons
  btnQueuedOutline: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#fefce8",
    color: "#ca8a04",
    border: "1px solid #fde68a",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
  },
  btnPostedDisabled: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#f0fdf4",
    color: "#16a34a",
    border: "1px solid #bbf7d0",
    cursor: "default",
    fontSize: "13px",
    fontWeight: 500,
  },
  btnPostingDisabled: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#eff6ff",
    color: "#2563eb",
    border: "1px solid #bfdbfe",
    cursor: "default",
    fontSize: "13px",
    fontWeight: 500,
  },
  btnDisabled: {
    width: "100%",
    padding: "10px",
    borderRadius: "6px",
    background: "#f9fafb",
    color: "#9ca3af",
    border: "1px solid #e5e7eb",
    cursor: "default",
    fontSize: "13px",
    fontWeight: 500,
  },

  // Description Dropdown
  descriptionDropdown: {
    marginTop: "12px",
    borderTop: "1px solid #e5e5e5",
  },
  descriptionToggle: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "12px",
  },
  descriptionToggleLabel: {
    fontWeight: 600,
    color: "#999",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  descriptionArrow: {
    fontSize: "12px",
    color: "#999",
    transition: "transform 0.2s",
  },
  descriptionContent: {
    paddingBottom: "8px",
  },
  descriptionText: {
    fontSize: "13px",
    lineHeight: "1.5",
    color: "#444",
    margin: "0 0 8px 0",
    whiteSpace: "pre-wrap" as const,
    maxHeight: "200px",
    overflowY: "auto" as const,
  },
  copyDescBtn: {
    padding: "5px 12px",
    borderRadius: "4px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#666",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 500,
  },
};
