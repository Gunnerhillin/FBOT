"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../lib/auth-context";
import { authFetch } from "../../lib/api-client";
import NavBar from "../components/NavBar";

interface SalespersonProfile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "salesperson";
  daily_post_limit: number;
  is_active: boolean;
  created_at: string;
}

interface UserStats {
  user_id: string;
  posted_today: number;
  queued: number;
  total_posted: number;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<SalespersonProfile[]>([]);
  const [userStats, setUserStats] = useState<Record<string, UserStats>>({});
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showMessage = useCallback((text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const fetchUsers = async () => {
    const res = await authFetch("/api/admin/users");
    const data = await res.json();
    if (Array.isArray(data.users)) setUsers(data.users);
    if (data.stats) {
      const statsMap: Record<string, UserStats> = {};
      for (const s of data.stats) statsMap[s.user_id] = s;
      setUserStats(statsMap);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== "admin") {
      window.location.href = "/inventory";
      return;
    }
    fetchUsers();
    const interval = setInterval(fetchUsers, 30000);
    return () => clearInterval(interval);
  }, [authLoading, user]);

  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    try {
      const res = await authFetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          full_name: inviteName,
          password: invitePassword,
        }),
      });
      const data = await res.json();
      if (data.error) {
        showMessage(data.error, "error");
      } else {
        showMessage(`${inviteName} has been added`, "success");
        setInviteEmail("");
        setInviteName("");
        setInvitePassword("");
        setShowInvite(false);
        fetchUsers();
      }
    } catch {
      showMessage("Failed to create user", "error");
    }
    setInviteLoading(false);
  };

  const approveUser = async (userId: string) => {
    const res = await authFetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, is_active: true }),
    });
    const data = await res.json();
    if (data.error) showMessage(data.error, "error");
    else { showMessage("Account approved", "success"); fetchUsers(); }
  };

  const denyUser = async (userId: string) => {
    const res = await authFetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, is_active: false }),
    });
    const data = await res.json();
    if (data.error) showMessage(data.error, "error");
    else { showMessage("Account denied", "success"); fetchUsers(); }
  };

  const toggleActive = async (userId: string, currentlyActive: boolean) => {
    const res = await authFetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, is_active: !currentlyActive }),
    });
    const data = await res.json();
    if (data.error) showMessage(data.error, "error");
    else fetchUsers();
  };

  const updateLimit = async (userId: string, newLimit: number) => {
    const res = await authFetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, daily_post_limit: newLimit }),
    });
    const data = await res.json();
    if (data.error) showMessage(data.error, "error");
    else fetchUsers();
  };

  const updateRole = async (userId: string, newRole: string) => {
    const res = await authFetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    const data = await res.json();
    if (data.error) showMessage(data.error, "error");
    else fetchUsers();
  };

  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ color: "#999" }}>Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== "admin") return null;

  // Split users into pending vs active/disabled
  const pendingUsers = users.filter((u) => !u.is_active && u.role !== "admin");
  const activeUsers = users.filter((u) => u.is_active || u.role === "admin");
  const totalPostsToday = Object.values(userStats).reduce((sum, s) => sum + (s.posted_today || 0), 0);
  const totalQueued = Object.values(userStats).reduce((sum, s) => sum + (s.queued || 0), 0);

  return (
    <div style={styles.page}>
      <NavBar />

      {/* Message toast */}
      {message && (
        <div style={{
          position: "fixed", top: "20px", right: "20px", zIndex: 9999,
          padding: "14px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 500,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          background: message.type === "success" ? "#111" : "#dc2626", color: "#fff",
        }}>
          {message.text}
        </div>
      )}

      <div style={styles.container}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Admin Panel</h1>
            <p style={styles.subtitle}>Manage salespeople, approve accounts, and monitor activity</p>
          </div>
          <button style={styles.inviteBtn} onClick={() => setShowInvite(!showInvite)}>
            {showInvite ? "Cancel" : "+ Add Salesperson"}
          </button>
        </div>

        {/* ── Pending Approvals ── */}
        {pendingUsers.length > 0 && (
          <div style={styles.pendingSection}>
            <div style={styles.pendingHeader}>
              <span style={styles.pendingDot} />
              <h2 style={styles.pendingTitle}>
                Pending Approvals ({pendingUsers.length})
              </h2>
            </div>
            <div style={styles.pendingGrid}>
              {pendingUsers.map((u) => (
                <div key={u.id} style={styles.pendingCard}>
                  <div style={styles.pendingInfo}>
                    <div style={{ fontWeight: 600, fontSize: "15px" }}>{u.full_name}</div>
                    <div style={{ fontSize: "13px", color: "#888" }}>{u.email}</div>
                    <div style={{ fontSize: "12px", color: "#bbb", marginTop: "4px" }}>
                      Signed up {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={styles.pendingActions}>
                    <button style={styles.approveBtn} onClick={() => approveUser(u.id)}>
                      Approve
                    </button>
                    <button style={styles.denyBtn} onClick={() => denyUser(u.id)}>
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats overview */}
        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <span style={styles.statValue}>{activeUsers.filter((u) => u.is_active).length}</span>
            <span style={styles.statLabel}>Active Users</span>
          </div>
          <div style={styles.statCard}>
            <span style={styles.statValue}>{pendingUsers.length}</span>
            <span style={styles.statLabel}>Pending</span>
          </div>
          <div style={styles.statCard}>
            <span style={styles.statValue}>{totalPostsToday}</span>
            <span style={styles.statLabel}>Posts Today</span>
          </div>
          <div style={styles.statCard}>
            <span style={styles.statValue}>{totalQueued}</span>
            <span style={styles.statLabel}>Total Queued</span>
          </div>
        </div>

        {/* Invite Form */}
        {showInvite && (
          <div style={styles.inviteCard}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 16px 0" }}>
              Add New Salesperson (pre-approved)
            </h3>
            <form onSubmit={inviteUser} style={styles.inviteForm}>
              <input
                style={styles.input}
                placeholder="Full name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
              />
              <input
                style={styles.input}
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <input
                style={styles.input}
                type="password"
                placeholder="Temporary password"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                required
                minLength={6}
              />
              <button
                type="submit"
                style={{ ...styles.submitBtn, opacity: inviteLoading ? 0.7 : 1 }}
                disabled={inviteLoading}
              >
                {inviteLoading ? "Creating..." : "Create Account"}
              </button>
            </form>
          </div>
        )}

        {/* Users Table */}
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Daily Limit</th>
                <th style={styles.th}>Posted Today</th>
                <th style={styles.th}>In Queue</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((u) => {
                const stats = userStats[u.id] || { posted_today: 0, queued: 0, total_posted: 0 };
                const isMe = u.id === user.id;
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={styles.td}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px" }}>
                          {u.full_name} {isMe && <span style={{ color: "#999", fontWeight: 400 }}>(you)</span>}
                        </div>
                        <div style={{ fontSize: "12px", color: "#999" }}>{u.email}</div>
                      </div>
                    </td>
                    <td style={styles.td}>
                      {isMe ? (
                        <span style={{
                          fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
                          textTransform: "uppercase" as const, letterSpacing: "0.3px",
                          color: "#7c3aed", background: "#f5f3ff",
                        }}>
                          admin
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) => updateRole(u.id, e.target.value)}
                          style={styles.roleSelect}
                        >
                          <option value="salesperson">Salesperson</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td style={styles.td}>
                      <select
                        value={u.daily_post_limit}
                        onChange={(e) => updateLimit(u.id, parseInt(e.target.value))}
                        style={styles.limitSelect}
                      >
                        {[5, 10, 15, 20].map((n) => (
                          <option key={n} value={n}>{n}/day</option>
                        ))}
                      </select>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                        {stats.posted_today}/{u.daily_post_limit}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontFamily: "monospace" }}>{stats.queued}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
                        ...(u.is_active
                          ? { color: "#16a34a", background: "#f0fdf4" }
                          : { color: "#dc2626", background: "#fef2f2" }),
                      }}>
                        {u.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td style={styles.td}>
                      {!isMe && (
                        <button
                          style={{
                            ...styles.toggleBtn,
                            ...(u.is_active ? styles.toggleBtnDisable : styles.toggleBtnEnable),
                          }}
                          onClick={() => toggleActive(u.id, u.is_active)}
                        >
                          {u.is_active ? "Disable" : "Enable"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: "#fff", minHeight: "100vh", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#111" },
  container: { maxWidth: "1000px", margin: "0 auto", padding: "32px 24px" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" },
  title: { fontSize: "28px", fontWeight: 700, margin: "0 0 4px 0", letterSpacing: "-0.5px" },
  subtitle: { fontSize: "14px", color: "#888", margin: 0 },
  inviteBtn: { padding: "10px 20px", borderRadius: "8px", border: "none", background: "#111", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 },

  // Pending approvals
  pendingSection: { marginBottom: "32px", border: "2px solid #f59e0b", borderRadius: "10px", padding: "24px", background: "#fffbeb" },
  pendingHeader: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" },
  pendingDot: { width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b", flexShrink: 0 },
  pendingTitle: { fontSize: "18px", fontWeight: 700, margin: 0, color: "#92400e" },
  pendingGrid: { display: "flex", flexDirection: "column" as const, gap: "12px" },
  pendingCard: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #fde68a", borderRadius: "8px", padding: "16px 20px" },
  pendingInfo: {},
  pendingActions: { display: "flex", gap: "10px" },
  approveBtn: { padding: "8px 20px", borderRadius: "6px", border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600 },
  denyBtn: { padding: "8px 20px", borderRadius: "6px", border: "1px solid #dc2626", background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: "13px", fontWeight: 600 },

  // Stats
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" },
  statCard: { background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: "8px", padding: "20px", display: "flex", flexDirection: "column" as const, alignItems: "center", gap: "4px" },
  statValue: { fontSize: "28px", fontWeight: 800, letterSpacing: "-1px" },
  statLabel: { fontSize: "12px", color: "#888", fontWeight: 500 },

  // Invite form
  inviteCard: { background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: "8px", padding: "24px", marginBottom: "32px" },
  inviteForm: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "12px", alignItems: "end" },
  input: { padding: "10px 12px", borderRadius: "6px", border: "1px solid #ddd", fontSize: "14px" },
  submitBtn: { padding: "10px 20px", borderRadius: "6px", background: "#111", color: "#fff", border: "none", cursor: "pointer", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap" as const },

  // Table
  tableCard: { background: "#fff", border: "1px solid #e5e5e5", borderRadius: "8px", overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" as const },
  th: { textAlign: "left" as const, padding: "14px 16px", fontSize: "12px", fontWeight: 600, color: "#888", textTransform: "uppercase" as const, letterSpacing: "0.3px", borderBottom: "1px solid #e5e5e5", background: "#fafafa" },
  td: { padding: "14px 16px", fontSize: "14px", verticalAlign: "middle" as const },
  limitSelect: { padding: "4px 8px", borderRadius: "4px", border: "1px solid #ddd", fontSize: "13px", fontWeight: 500, cursor: "pointer" },
  roleSelect: { padding: "4px 8px", borderRadius: "4px", border: "1px solid #ddd", fontSize: "13px", fontWeight: 500, cursor: "pointer" },
  toggleBtn: { padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 600, border: "none" },
  toggleBtnDisable: { background: "#fef2f2", color: "#dc2626" },
  toggleBtnEnable: { background: "#f0fdf4", color: "#16a34a" },
};
