export function exportAuditLogs(db, format = "json") {
  const logs = db.auditLogs || [];
  if (format === "csv") {
    const header = ["id", "createdAt", "actor", "action", "target", "severity"];
    const rows = logs.map((log) => header.map((key) => csvCell(log[key])).join(","));
    return `${header.join(",")}\n${rows.join("\n")}`;
  }
  return JSON.stringify(logs, null, 2);
}

export function exportTraces(db, format = "json") {
  const traces = db.traces || [];
  if (format === "csv") {
    const header = ["id", "createdAt", "type", "title", "status", "latencyMs"];
    const rows = traces.map((trace) => header.map((key) => csvCell(trace[key])).join(","));
    return `${header.join(",")}\n${rows.join("\n")}`;
  }
  return JSON.stringify(traces, null, 2);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
