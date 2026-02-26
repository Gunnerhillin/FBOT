"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Redirect to inventory page on success
    window.location.href = "/inventory";
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Left side — branding */}
        <div style={styles.brandSide}>
          <div style={styles.brandContent}>
            <div style={styles.logoMark}>NBG</div>
            <h1 style={styles.brandTitle}>Newby Buick GMC</h1>
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

        {/* Right side — login form */}
        <div style={styles.formSide}>
          <div style={styles.formContainer}>
            <h2 style={styles.formTitle}>Sign in</h2>
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
                  placeholder="you@newbybuickgmc.com"
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
                style={{
                  ...styles.submitBtn,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <p style={styles.footerText}>
              Contact your admin if you need an account
            </p>
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
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: {
    display: "flex",
    minHeight: "100vh",
  },

  // Brand side
  brandSide: {
    flex: 1,
    background: "#111",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px",
  },
  brandContent: {
    maxWidth: "420px",
  },
  logoMark: {
    width: "56px",
    height: "56px",
    borderRadius: "12px",
    background: "#fff",
    color: "#111",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    fontWeight: 800,
    letterSpacing: "-0.5px",
    marginBottom: "32px",
  },
  brandTitle: {
    fontSize: "32px",
    fontWeight: 800,
    margin: "0 0 8px 0",
    letterSpacing: "-1px",
    lineHeight: "1.1",
  },
  brandSubtitle: {
    fontSize: "16px",
    color: "#999",
    margin: "0 0 32px 0",
    fontWeight: 400,
  },
  brandDivider: {
    width: "48px",
    height: "2px",
    background: "#333",
    marginBottom: "32px",
  },
  brandDescription: {
    fontSize: "15px",
    color: "#888",
    lineHeight: "1.6",
    margin: "0 0 36px 0",
  },
  featureList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
  },
  featureItem: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    fontSize: "14px",
    color: "#ccc",
  },
  featureIcon: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: "#222",
    color: "#888",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 700,
    flexShrink: 0,
  },

  // Form side
  formSide: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px",
    background: "#fafafa",
  },
  formContainer: {
    width: "100%",
    maxWidth: "380px",
  },
  formTitle: {
    fontSize: "28px",
    fontWeight: 700,
    margin: "0 0 8px 0",
    letterSpacing: "-0.5px",
    color: "#111",
  },
  formSubtitle: {
    fontSize: "14px",
    color: "#888",
    margin: "0 0 36px 0",
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "20px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#444",
  },
  input: {
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "15px",
    background: "#fff",
    outline: "none",
    transition: "border-color 0.2s",
  },
  errorBox: {
    padding: "12px 14px",
    borderRadius: "8px",
    background: "#fef2f2",
    color: "#dc2626",
    fontSize: "14px",
    fontWeight: 500,
    border: "1px solid #fecaca",
  },
  submitBtn: {
    padding: "14px",
    borderRadius: "8px",
    border: "none",
    background: "#111",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "4px",
  },
  footerText: {
    fontSize: "13px",
    color: "#aaa",
    textAlign: "center" as const,
    marginTop: "28px",
  },
};
