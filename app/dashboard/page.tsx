"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../lib/auth-context";
import { authFetch } from "../../lib/api-client";
import NavBar from "../components/NavBar";

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userStats, setUserStats] = useState<Record<string, any>>({});

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      window.location.href = "/";
      return;
    }

    authFetch("/api/vehicles")
      .then((r) => r.json())
      .then((data) => setVehicles(Array.isArray(data) ? data : []));

    // Admin can see all user stats
    if (isAdmin) {
      authFetch("/api/admin/users")
        .then((r) => r.json())
        .then((data) => {
          if (data.users) setAllUsers(data.users);
          if (data.stats) {
            const map: Record<string, any> = {};
            for (const s of data.stats) map[s.user_id] = s;
            setUserStats(map);
          }
        });
    }
  }, [authLoading, user]);

  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ color: "#999" }}>Loading...</p>
      </div>
    );
  }
  if (!user) return null;

  const total = vehicles.length;
  const withPhotos = vehicles.filter((v) => v.photos && v.photos.length > 0).length;
  const withDescriptions = vehicles.filter((v) => v.description_a).length;
  const posted = vehicles.filter((v) => v.fb_status === "posted").length;
  const notPosted = vehicles.filter((v) => !v.fb_status || v.fb_status === "not_posted").length;
  const queued = vehicles.filter((v) => v.fb_status === "queued").length;
  const failed = vehicles.filter((v) => v.fb_status === "failed").length;
  const avgPrice = total > 0
    ? Math.round(vehicles.reduce((sum, v) => sum + (Number(v.price) || 0), 0) / total)
    : 0;

  // My stats
  const myQueued = vehicles.filter((v) => v.fb_status === "queued" && v.queued_by === user.id).length;

  const stats = [
    { label: "Total Vehicles", value: total, color: "#111" },
    { label: "Posted to FB", value: posted, color: "#16a34a" },
    { label: "Not Posted", value: notPosted, color: "#dc2626" },
    { label: "Queued (all)", value: queued, color: "#ca8a04" },
    { label: "My Queue", value: myQueued, color: "#2563eb" },
    { label: "Failed", value: failed, color: "#dc2626" },
    { label: "With Photos", value: `${withPhotos}/${total}`, color: "#111" },
    { label: "Descriptions", value: `${withDescriptions}/${total}`, color: "#111" },
    { label: "Avg Price", value: avgPrice > 0 ? `$${avgPrice.toLocaleString()}` : "—", color: "#111" },
  ];

  const ready = vehicles.filter((v) => v.photos?.length > 0 && v.description_a && v.fb_status === "posted").length;
  const readyPct = total > 0 ? Math.round((ready / total) * 100) : 0;

  return (
    <div style={styles.page}>
      <NavBar />

      <main style={styles.main}>
        {/* Readiness bar */}
        <div style={styles.readinessCard}>
          <div style={styles.readinessHeader}>
            <span style={styles.readinessLabel}>Posting Readiness</span>
            <span style={styles.readinessPct}>{readyPct}%</span>
          </div>
          <div style={styles.progressBg}>
            <div style={{ ...styles.progressFill, width: `${readyPct}%` }} />
          </div>
          <p style={styles.readinessSubtext}>
            {ready} of {total} vehicles have photos, descriptions, and are posted
          </p>
        </div>

        {/* Stats grid */}
        <div style={styles.statsGrid}>
          {stats.map((s) => (
            <div key={s.label} style={styles.statCard}>
              <p style={styles.statLabel}>{s.label}</p>
              <p style={{ ...styles.statValue, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Per-user breakdown (admin only) */}
        {isAdmin && allUsers.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Team Activity Today</h2>
            <div style={styles.teamGrid}>
              {allUsers.map((u: any) => {
                const s = userStats[u.id] || { posted_today: 0, queued: 0, total_posted: 0 };
                return (
                  <div key={u.id} style={styles.teamCard}>
                    <div style={styles.teamHeader}>
                      <span style={styles.teamName}>{u.full_name}</span>
                      <span style={{
                        fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
                        ...(u.is_active
                          ? { color: "#16a34a", background: "#f0fdf4" }
                          : { color: "#dc2626", background: "#fef2f2" }),
                      }}>
                        {u.is_active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <div style={styles.teamStats}>
                      <div style={styles.teamStat}>
                        <span style={styles.teamStatValue}>{s.posted_today}</span>
                        <span style={styles.teamStatLabel}>Posted Today</span>
                      </div>
                      <div style={styles.teamStat}>
                        <span style={styles.teamStatValue}>{s.queued}</span>
                        <span style={styles.teamStatLabel}>In Queue</span>
                      </div>
                      <div style={styles.teamStat}>
                        <span style={styles.teamStatValue}>{s.total_posted}</span>
                        <span style={styles.teamStatLabel}>All Time</span>
                      </div>
                    </div>
                    <div style={styles.progressBg}>
                      <div style={{
                        ...styles.progressFill,
                        width: `${Math.min(100, (s.posted_today / u.daily_post_limit) * 100)}%`,
                        background: s.posted_today >= u.daily_post_limit ? "#16a34a" : "#111",
                      }} />
                    </div>
                    <p style={{ fontSize: "11px", color: "#999", margin: "4px 0 0" }}>
                      {s.posted_today}/{u.daily_post_limit} daily limit
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pipeline breakdown */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Pipeline Status</h2>
          <div style={styles.pipelineGrid}>
            <PipelineStep label="PDF Uploaded" count={total} total={total} color="#111" />
            <PipelineArrow />
            <PipelineStep label="Photos Scraped" count={withPhotos} total={total} color="#111" />
            <PipelineArrow />
            <PipelineStep label="Description Generated" count={withDescriptions} total={total} color="#111" />
            <PipelineArrow />
            <PipelineStep label="Posted to FB" count={posted} total={total} color="#16a34a" />
          </div>
        </div>

        {/* Vehicles missing photos or descriptions */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Needs Attention</h2>
          <div style={styles.attentionGrid}>
            {vehicles
              .filter((v) => !v.photos?.length || !v.description_a)
              .slice(0, 10)
              .map((v) => (
                <div key={v.id} style={styles.attentionRow}>
                  <span style={styles.attentionName}>
                    {v.year} {v.make} {v.model}
                  </span>
                  <div style={styles.attentionTags}>
                    {!v.photos?.length && <span style={styles.tagRed}>No Photos</span>}
                    {!v.description_a && <span style={styles.tagYellow}>No Description</span>}
                  </div>
                </div>
              ))}
            {vehicles.filter((v) => !v.photos?.length || !v.description_a).length === 0 && (
              <p style={{ color: "#999", textAlign: "center", padding: "20px" }}>
                All vehicles have photos and descriptions
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function PipelineStep({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={styles.pipelineStep}>
      <p style={{ ...styles.pipelineCount, color }}>{count}</p>
      <p style={styles.pipelineLabel}>{label}</p>
      <p style={styles.pipelinePct}>{pct}%</p>
    </div>
  );
}

function PipelineArrow() {
  return <div style={styles.pipelineArrow}>&rarr;</div>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: "#fff", minHeight: "100vh", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#111" },
  main: { maxWidth: "1200px", margin: "0 auto", padding: "24px" },

  readinessCard: { border: "1px solid #e5e5e5", borderRadius: "8px", padding: "24px", marginBottom: "24px" },
  readinessHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" },
  readinessLabel: { fontSize: "16px", fontWeight: 600 },
  readinessPct: { fontSize: "24px", fontWeight: 800 },
  progressBg: { height: "8px", background: "#f0f0f0", borderRadius: "4px", overflow: "hidden" },
  progressFill: { height: "100%", background: "#111", borderRadius: "4px", transition: "width 0.3s" },
  readinessSubtext: { fontSize: "13px", color: "#999", marginTop: "8px" },

  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" },
  statCard: { border: "1px solid #e5e5e5", borderRadius: "8px", padding: "20px", textAlign: "center" as const },
  statLabel: { fontSize: "12px", color: "#999", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.5px", margin: "0 0 8px 0" },
  statValue: { fontSize: "28px", fontWeight: 800, margin: 0 },

  // Team cards (admin)
  section: { marginBottom: "32px" },
  sectionTitle: { fontSize: "16px", fontWeight: 600, margin: "0 0 16px 0" },
  teamGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" },
  teamCard: { border: "1px solid #e5e5e5", borderRadius: "8px", padding: "20px" },
  teamHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" },
  teamName: { fontSize: "15px", fontWeight: 600 },
  teamStats: { display: "flex", justifyContent: "space-between", marginBottom: "12px" },
  teamStat: { textAlign: "center" as const },
  teamStatValue: { fontSize: "20px", fontWeight: 800, display: "block" },
  teamStatLabel: { fontSize: "11px", color: "#999" },

  // Pipeline
  pipelineGrid: { display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", border: "1px solid #e5e5e5", borderRadius: "8px", padding: "24px" },
  pipelineStep: { textAlign: "center" as const, flex: 1 },
  pipelineCount: { fontSize: "32px", fontWeight: 800, margin: "0 0 4px 0" },
  pipelineLabel: { fontSize: "13px", color: "#666", margin: "0 0 2px 0" },
  pipelinePct: { fontSize: "12px", color: "#999", margin: 0 },
  pipelineArrow: { fontSize: "24px", color: "#ccc", fontWeight: 300 },

  // Attention
  attentionGrid: { border: "1px solid #e5e5e5", borderRadius: "8px", overflow: "hidden" },
  attentionRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #f0f0f0" },
  attentionName: { fontSize: "14px", fontWeight: 500 },
  attentionTags: { display: "flex", gap: "8px" },
  tagRed: { fontSize: "11px", fontWeight: 600, color: "#dc2626", background: "#fef2f2", padding: "3px 8px", borderRadius: "4px" },
  tagYellow: { fontSize: "11px", fontWeight: 600, color: "#ca8a04", background: "#fefce8", padding: "3px 8px", borderRadius: "4px" },
};
