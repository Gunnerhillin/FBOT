"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Check if account is approved (is_active)
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", data.user.id)
      .single();

    if (profile && !profile.is_active) {
      setError("Your account is pending approval. An admin will activate it soon.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    window.location.href = "/inventory";
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role: "salesperson" },
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    setSuccess("Account created! An admin will review and approve your account shortly.");
    setEmail("");
    setPassword("");
    setFullName("");
    setLoading(false);
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Left side — branding */}
        <div style={styles.brandSide}>
          <div style={styles.brandContent}>
            <div style={styles.logoMark}>FP</div>
            <h1 style={styles.brandTitle}>FB Poster by Gunner</h1>
            <p style={styles.brandSubtitle}>
              Facebook Marketplace Posting Tool
            </p>
            <div style={styles.brandDivider} />
            <p style={styles.brandDescription}>
              Manage your inventory, generate AI-powered descriptions, and
              automatically post vehicles to Facebook Marketplace.
            </p>
            <div style={styles.featureList}>
              <div style={styles.featureItem}>
                <span style={styles.featureIcon}>1</span>
                <span>Upload vAuto inventory</span>
              </div>
              <div style={styles.featureItem}>
                <span style={styles.featureIcon}>2</span>
                <span>Auto-scrape photos & generate descriptions</span>
              </div>
              <div style={styles.featureItem}>
                <span style={styles.featureIcon}>3</span>
                <span>Queue & post to Facebook automatically</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right side — login/signup form */}
        <div style={styles.formSide}>
          <div style={styles.formContainer}>
            {/* Tab switcher */}
            <div style={styles.tabs}>
              <button
                style={{ ...styles.tab, ...(mode === "login" ? styles.tabActive : {}) }}
                onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
              >
                Sign In
              </button>
              <button
                style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }}
                onClick={() => { setMode("signup"); setError(""); setSuccess(""); }}
              >
                Create Account
              </button>
            </div>

            {mode === "login" ? (
              <>
                <p style={styles.formSubtitle}>
                  Enter your credentials to access the tool
                </p>
                <form onSubmit={handleLogin} style={styles.form}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      style={styles.input}
                      required
                      autoFocus
                    />
                  </div>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      style={styles.input}
                      required
                    />
                  </div>
                  {error && <div style={styles.errorBox}>{error}</div>}
                  <button
                    type="submit"
                    style={{ ...styles.submitBtn, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}
                    disabled={loading}
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <p style={styles.formSubtitle}>
                  Create an account — an admin will approve it before you can log in
                </p>
                <form onSubmit={handleSignup} style={styles.form}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="John Smith"
                      style={styles.input}
                      required
                      autoFocus
                    />
                  </div>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      style={styles.input}
                      required
                    />
                  </div>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      style={styles.input}
                      required
                      minLength={6}
                    />
                  </div>
                  {error && <div style={styles.errorBox}>{error}</div>}
                  {success && <div style={styles.successBox}>{success}</div>}
                  <button
                    type="submit"
                    style={{ ...styles.submitBtn, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}
                    disabled={loading}
                  >
                    {loading ? "Creating Account..." : "Create Account"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#fff",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: { display: "flex", minHeight: "100vh" },

  // Brand side
  brandSide: { flex: 1, background: "#111", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px" },
  brandContent: { maxWidth: "420px" },
  logoMark: { width: "56px", height: "56px", borderRadius: "12px", background: "#fff", color: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "32px" },
  brandTitle: { fontSize: "32px", fontWeight: 800, margin: "0 0 8px 0", letterSpacing: "-1px", lineHeight: "1.1" },
  brandSubtitle: { fontSize: "16px", color: "#999", margin: "0 0 32px 0", fontWeight: 400 },
  brandDivider: { width: "48px", height: "2px", background: "#333", marginBottom: "32px" },
  brandDescription: { fontSize: "15px", color: "#888", lineHeight: "1.6", margin: "0 0 36px 0" },
  featureList: { display: "flex", flexDirection: "column" as const, gap: "16px" },
  featureItem: { display: "flex", alignItems: "center", gap: "14px", fontSize: "14px", color: "#ccc" },
  featureIcon: { width: "28px", height: "28px", borderRadius: "50%", background: "#222", color: "#888", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, flexShrink: 0 },

  // Form side
  formSide: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px", background: "#fafafa" },
  formContainer: { width: "100%", maxWidth: "400px" },

  // Tabs
  tabs: { display: "flex", gap: "0", marginBottom: "24px", borderBottom: "2px solid #e5e5e5" },
  tab: { flex: 1, padding: "12px 0", background: "none", border: "none", borderBottom: "2px solid transparent", marginBottom: "-2px", fontSize: "15px", fontWeight: 500, color: "#999", cursor: "pointer", transition: "all 0.15s" },
  tabActive: { color: "#111", fontWeight: 600, borderBottomColor: "#111" },

  formSubtitle: { fontSize: "14px", color: "#888", margin: "0 0 24px 0" },
  form: { display: "flex", flexDirection: "column" as const, gap: "18px" },
  fieldGroup: { display: "flex", flexDirection: "column" as const, gap: "6px" },
  label: { fontSize: "13px", fontWeight: 600, color: "#444" },
  input: { padding: "12px 14px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "15px", background: "#fff", outline: "none", transition: "border-color 0.2s" },
  errorBox: { padding: "12px 14px", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", fontSize: "14px", fontWeight: 500, border: "1px solid #fecaca" },
  successBox: { padding: "12px 14px", borderRadius: "8px", background: "#f0fdf4", color: "#16a34a", fontSize: "14px", fontWeight: 500, border: "1px solid #bbf7d0" },
  submitBtn: { padding: "14px", borderRadius: "8px", border: "none", background: "#111", color: "#fff", fontSize: "15px", fontWeight: 600, cursor: "pointer", marginTop: "4px" },
};
