"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [vehicle, setVehicle] = useState("");
  const [price, setPrice] = useState("");
  const [result, setResult] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // -----------------------------
  // Fetch Vehicles
  // -----------------------------
  const fetchVehicles = async () => {
    const res = await fetch("/api/vehicles");
    const data = await res.json();
    setVehicles(data);
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  // -----------------------------
  // Generate Single Post
  // -----------------------------
  const generatePost = async () => {
    if (!vehicle || !price) {
      alert("Enter vehicle and price");
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
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    alert("Copied to clipboard");
  };

  // -----------------------------
  // Upload Inventory
  // -----------------------------
  const handleUploadInventory = async () => {
    if (!inventoryText) {
      alert("Paste inventory first");
      return;
    }

    const res = await fetch("/api/upload-inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: inventoryText }),
    });

    const data = await res.json();
    alert(JSON.stringify(data));
    fetchVehicles();
  };

  // -----------------------------
  // Delete All Inventory
  // -----------------------------
  const deleteAllInventory = async () => {
    const confirmDelete = confirm(
      "Are you sure you want to delete ALL inventory and descriptions?"
    );

    if (!confirmDelete) return;

    const res = await fetch("/api/delete-all", {
      method: "POST",
    });

    const data = await res.json();

    if (data.error) {
      alert(data.error);
    } else {
      alert("All inventory deleted");
      fetchVehicles();
    }
  };

  // -----------------------------
  // Generate Description For DB Vehicle
  // -----------------------------
  const generateDescriptionForVehicle = async (id: number) => {
    setLoading(true);

    const res = await fetch("/api/generate-from-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const data = await res.json();

    if (data.error) {
      alert(data.error);
    } else {
      alert("Description Generated");
      fetchVehicles();
    }

    setLoading(false);
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>🚗 FB Marketplace Tool</h1>

        {/* SINGLE POST */}
        <h2>Generate Single Post</h2>

        <input
          style={styles.input}
          placeholder="Vehicle (Example: 2022 GMC Sierra)"
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
        />

        <input
          style={styles.input}
          placeholder="Price (Example: 22,500)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />

        <button style={styles.primaryButton} onClick={generatePost}>
          {loading ? "Generating..." : "Generate Post"}
        </button>

        {result && (
          <div style={styles.resultBox}>
            <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
            <button style={styles.copyButton} onClick={copyToClipboard}>
              Copy
            </button>
          </div>
        )}

        <hr style={styles.divider} />

        {/* UPLOAD INVENTORY */}
        <h2>Upload Inventory</h2>

        <textarea
          style={styles.textarea}
          placeholder="Paste full inventory here..."
          value={inventoryText}
          onChange={(e) => setInventoryText(e.target.value)}
        />

        <button style={styles.uploadButton} onClick={handleUploadInventory}>
          Upload Inventory
        </button>

        <button style={styles.deleteButton} onClick={deleteAllInventory}>
          Delete All Inventory
        </button>

        <hr style={styles.divider} />

        {/* INVENTORY LIST */}
        <h2>Your Inventory</h2>

        {vehicles.map((v) => (
          <div key={v.id} style={styles.vehicleCard}>
            <strong>
              {v.year} {v.make} {v.model}
            </strong>

            <div>Price: {v.price}</div>
            <div>Mileage: {v.mileage}</div>

            <button
              style={styles.smallButton}
              onClick={() => generateDescriptionForVehicle(v.id)}
            >
              Generate Description
            </button>

            {v.description_a && (
              <div style={styles.descriptionBox}>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {v.description_a}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------
// Styles
// -----------------------------
const styles: any = {
  page: {
    background: "#0f172a",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    padding: "40px",
  },
  card: {
    background: "#1e293b",
    padding: "40px",
    borderRadius: "16px",
    width: "650px",
    color: "white",
  },
  title: {
    textAlign: "center",
    marginBottom: "20px",
  },
  input: {
    width: "100%",
    padding: "12px",
    marginBottom: "10px",
    borderRadius: "8px",
    border: "none",
  },
  textarea: {
    width: "100%",
    height: "200px",
    padding: "12px",
    borderRadius: "8px",
    marginBottom: "10px",
    border: "none",
  },
  primaryButton: {
    width: "100%",
    padding: "12px",
    borderRadius: "8px",
    background: "#3b82f6",
    color: "white",
    border: "none",
    cursor: "pointer",
    marginBottom: "20px",
  },
  uploadButton: {
    width: "100%",
    padding: "12px",
    borderRadius: "8px",
    background: "#22c55e",
    color: "white",
    border: "none",
    cursor: "pointer",
    marginBottom: "10px",
  },
  deleteButton: {
    width: "100%",
    padding: "12px",
    borderRadius: "8px",
    background: "#dc2626",
    color: "white",
    border: "none",
    cursor: "pointer",
  },
  resultBox: {
    background: "#0f172a",
    padding: "15px",
    borderRadius: "8px",
    marginTop: "20px",
  },
  copyButton: {
    marginTop: "10px",
    padding: "8px",
    borderRadius: "6px",
    background: "#f59e0b",
    border: "none",
    cursor: "pointer",
  },
  divider: {
    margin: "40px 0",
    opacity: 0.3,
  },
  vehicleCard: {
    background: "#334155",
    padding: "15px",
    borderRadius: "8px",
    marginBottom: "15px",
  },
  smallButton: {
    marginTop: "10px",
    padding: "6px 10px",
    borderRadius: "6px",
    background: "#3b82f6",
    border: "none",
    cursor: "pointer",
    color: "white",
  },
  descriptionBox: {
    marginTop: "10px",
    background: "#0f172a",
    padding: "10px",
    borderRadius: "6px",
  },
};
