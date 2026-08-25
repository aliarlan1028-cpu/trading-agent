import { ZERO_BASE_FAMILIES, ZERO_BASE_MOBILE_ROOTS } from "./zeroBaseArchitecture.js";

const familyById = new Map(ZERO_BASE_FAMILIES.map((item) => [item.id, item]));

export const MOBILE_PRIMARY_NAV = ZERO_BASE_MOBILE_ROOTS.map((item) => ({
  id: item.id,
  label: [item.label, item.labelEn],
  route: item.route,
  families: [...item.families]
}));

export const MOBILE_FAMILY_NAV = Object.freeze({
  today: Object.freeze(["today"]),
  ai: Object.freeze(["ai"]),
  assets: Object.freeze(["portfolio"]),
  intelligent: Object.freeze(["strategy", "knowledge", "capability", "reviews"]),
  more: Object.freeze(["guard", "operations", "configuration"])
});

export const MOBILE_MORE_FAMILIES = MOBILE_FAMILY_NAV.more;

const rootByFamily = new Map(Object.entries(MOBILE_FAMILY_NAV).flatMap(([root, families]) => families.map((family) => [family, root])));

export const mobileRootForFamily = (familyId) => rootByFamily.get(String(familyId || "")) || "ai";

export const mobileRootFamilies = (rootId) => (MOBILE_FAMILY_NAV[rootId] || []).map((id) => familyById.get(id)).filter(Boolean);

export const mobileFamilyDestinations = (familyId) => familyById.get(String(familyId || ""))?.views || [];

export const mobileFamily = (familyId) => familyById.get(String(familyId || "")) || familyById.get("ai");
