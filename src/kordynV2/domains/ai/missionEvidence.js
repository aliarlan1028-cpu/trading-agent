const unavailable = "Unavailable";
const receiptValue = (value) => typeof value === "string" && value ? value : unavailable;

export function missionEvidenceRequest(mission, panel = "proof") {
  return {
    panel,
    candidate: {
      id: mission.id,
      type: "Agent run",
      workspaceId: "ai",
      route: "chat",
      evidence: mission.evidenceCount
    },
    details: [
      ["创建", receiptValue(mission?.receipt?.createdAt)],
      ["更新", receiptValue(mission?.receipt?.updatedAt)],
      ["完成", receiptValue(mission?.receipt?.completedAt)]
    ]
  };
}
