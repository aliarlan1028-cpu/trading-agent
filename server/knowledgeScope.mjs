const KNOWLEDGE_COLLECTIONS = Object.freeze([
  "sources", "conceptCards", "ruleProposals", "tradingMethods", "tradingSkills",
  "skillInvocations", "skillAttributions", "strategyHypotheses", "reviewTemplates",
  "sourceVersions", "documentNodes", "chunks", "bookCards", "chapterCards",
  "theoryFrameworks", "caseCards", "conflicts", "expertGraphNodes", "expertGraphEdges",
  "masteryTests", "runtimeCitations", "candidates", "lenses", "workflows"
]);

export function normalizeKnowledgePrincipal(value = {}) {
  return {
    tenantId: String(value.tenantId || ""),
    userId: String(value.userId || value.id || ""),
    isOwner: value.isOwner === true
  };
}

function sourceIds(row = {}) {
  return [...new Set([
    row.sourceId,
    row.source?.id,
    ...(Array.isArray(row.sourceRefs) ? row.sourceRefs : [])
  ].filter(Boolean).map(String))];
}

// Explicit one-time ownership normalization for legacy rows. Platform doctrine
// is marked as platform scope; every other unscoped legacy row is attributed to
// the configured Owner instead of being implicitly shared.
export function ensureKnowledgeOwnership(db) {
  db.knowledge ||= {};
  const ownerTenantId = db.user?.tenantId || "tenant_owner";
  const ownerUserId = db.user?.id || null;
  const sources = db.knowledge.sources || [];
  const tenantOwnerId = (tenantId) => (db.tenants || []).find((tenant) => tenant.id === tenantId)?.ownerUserId
    || (db.users || []).find((user) => user.tenantId === tenantId && (user.isOwner === true || user.roleId === "role_admin"))?.id
    || (tenantId === ownerTenantId ? ownerUserId : null);
  for (const source of sources) {
    if (["doctrine", "manual_curated"].includes(source.type) && !source.tenantId) source.platformScope = "platform";
    else {
      source.tenantId ||= ownerTenantId;
      source.ownerUserId ||= tenantOwnerId(source.tenantId);
    }
  }
  const byId = new Map(sources.map((source) => [String(source.id), source]));
  for (const collection of KNOWLEDGE_COLLECTIONS.filter((name) => name !== "sources")) {
    for (const row of db.knowledge[collection] || []) {
      if (row.platformScope === "platform") continue;
      const parents = sourceIds(row).map((id) => byId.get(id)).filter(Boolean);
      if (!row.tenantId && parents.length && parents.every((source) => source.platformScope === "platform")) {
        row.platformScope = "platform";
      } else {
        const parent = parents.find((source) => source.tenantId) || null;
        row.tenantId ||= parent?.tenantId || ownerTenantId;
        row.ownerUserId ||= parent?.ownerUserId || tenantOwnerId(row.tenantId);
      }
    }
  }
  db.system ||= {};
  db.system.knowledgeOwnershipVersion = 1;
  return db.knowledge;
}

export function canReadKnowledgeRow(row, principalInput) {
  const principal = normalizeKnowledgePrincipal(principalInput);
  return row?.platformScope === "platform" || Boolean(principal.tenantId && row?.tenantId === principal.tenantId);
}

// Runtime decision inputs are user-private, even when multiple users share a
// tenant. Tenant-wide read access is suitable for the management UI, but it is
// too broad for injecting an artifact into one user's model prompt or plan.
export function canUseKnowledgeRow(row, principalInput) {
  const principal = normalizeKnowledgePrincipal(principalInput);
  if (row?.platformScope === "platform") return true;
  return Boolean(principal.tenantId && principal.userId
    && row?.tenantId === principal.tenantId
    && row?.ownerUserId === principal.userId);
}

export function canWriteKnowledgeRow(row, principalInput) {
  const principal = normalizeKnowledgePrincipal(principalInput);
  if (row?.platformScope === "platform") return principal.isOwner;
  return Boolean(principal.tenantId && principal.userId
    && row?.tenantId === principal.tenantId
    && (!row.ownerUserId || row.ownerUserId === principal.userId || principal.isOwner));
}

export function projectKnowledgeForPrincipal(db, principalInput) {
  ensureKnowledgeOwnership(db);
  const principal = normalizeKnowledgePrincipal(principalInput);
  const projected = { ...(db.knowledge || {}) };
  for (const collection of KNOWLEDGE_COLLECTIONS) {
    projected[collection] = (db.knowledge?.[collection] || []).filter((row) => canReadKnowledgeRow(row, principal));
  }
  return projected;
}
