"use client";

import { useAuth } from "../../lib/auth-context";
import { usePathname } from "next/navigation";

export default function NavBar() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  const isAdmin = user.role === "admin";

  const links = [
    { href: "/inventory", label: "Inventory" },
    { href: "/dashboard", label: "Dashboard" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav style={styles.nav}>
      <div style={styles.inner}>
        <div style={styles.left}>
          <a href="/inventory" style={styles.logo}>
            FB Marketplace Tool
          </a>
          <div style={styles.links}>
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                style={{
                  ...styles.link,
                  ...(pathname === link.href ? styles.linkActive : {}),
                }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div style={styles.right}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>{user.full_name}</span>
            <span
              style={{
                ...styles.roleBadge,
                ...(isAdmin ? styles.roleBadgeAdmin : styles.roleBadgeSales),
              }}
            >
              {isAdmin ? "Admin" : "Sales"}
            </span>
          </div>
          <button style={styles.signOutBtn} onClick={signOut}>
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    borderBottom: "1px solid #e5e5e5",
    padding: "0 24px",
    position: "sticky",
    top: 0,
    background: "#fff",
    zIndex: 100,
  },
  inner: {
    maxWidth: "1400px",
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    height: "56px",
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: "32px",
  },
  logo: {
    fontSize: "17px",
    fontWeight: 700,
    letterSpacing: "-0.5px",
    color: "#111",
    textDecoration: "none",
  },
  links: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  link: {
    padding: "6px 14px",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#666",
    textDecoration: "none",
    transition: "all 0.15s",
  },
  linkActive: {
    color: "#111",
    background: "#f5f5f5",
    fontWeight: 600,
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  userName: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#333",
  },
  roleBadge: {
    fontSize: "11px",
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: "4px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.3px",
  },
  roleBadgeAdmin: {
    color: "#7c3aed",
    background: "#f5f3ff",
  },
  roleBadgeSales: {
    color: "#0369a1",
    background: "#f0f9ff",
  },
  signOutBtn: {
    padding: "6px 14px",
    borderRadius: "6px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#666",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
  },
};
