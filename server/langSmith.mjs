import { appendTrace, id, nowIso } from "./store.mjs";

export async function recordLangSmithRun(db, run) {
  const trace = appendTrace(db, "langsmith", run.name || "Agent Run", "local_recorded");
  const payload = {
    id: id("ls"),
    traceId: trace.id,
    name: run.name,
    run_type: run.runType || "chain",
    inputs: run.inputs || {},
    outputs: run.outputs || {},
    start_time: run.startTime || nowIso(),
    end_time: nowIso(),
    project_name: process.env.LANGSMITH_PROJECT || "ai-trading-agent"
  };
  if (!process.env.LANGSMITH_API_KEY) return { status: "local_only", payload };
  try {
    const endpoint = process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com";
    const response = await fetch(`${endpoint}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.LANGSMITH_API_KEY
      },
      body: JSON.stringify(payload)
    });
    return { status: response.ok ? "sent" : "send_failed", httpStatus: response.status, payload };
  } catch (error) {
    return { status: "send_failed", error: error.message, payload };
  }
}
