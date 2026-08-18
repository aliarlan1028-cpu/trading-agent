export function normalizePrincipal(principal = {}) {
  return {
    tenantId: String(principal.tenantId || ""),
    userId: String(principal.userId || principal.id || ""),
    isOwner: principal.isOwner === true
  };
}

export function principalUserId(row = {}) {
  return row.ownerUserId || row.userId || row.createdByUserId
    || row.requestedByUserId || row.initiatorUserId || null;
}

export function belongsToPrincipal(row, principal) {
  const subject = normalizePrincipal(principal);
  return Boolean(subject.tenantId && subject.userId
    && row?.tenantId === subject.tenantId
    && principalUserId(row) === subject.userId);
}

export function canUsePrincipalRow(row, principal) {
  return row?.platformScope === "platform" || belongsToPrincipal(row, principal);
}

export function principalKey(principal) {
  const subject = normalizePrincipal(principal);
  return subject.tenantId && subject.userId ? `${subject.tenantId}:${subject.userId}` : null;
}

export function canAccessSkill(row, principal) {
  if (row?.native === true || row?.platformScope === "platform") return true;
  return belongsToPrincipal(row, principal);
}

export function projectSkillsForPrincipal(skills = [], principal) {
  return (skills || []).filter((row) => canAccessSkill(row, principal));
}
