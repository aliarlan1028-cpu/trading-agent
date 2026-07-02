const base = process.env.API_BASE_URL || "http://127.0.0.1:8787";

const response = await fetch(`${base}/api/system/backup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`backup failed: ${response.status} ${text}`);
}

const result = await response.json();
console.log(JSON.stringify(result, null, 2));
