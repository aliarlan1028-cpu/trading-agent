import { buildEventRows } from "../../../viewData.js";

const unavailable = "Unavailable";
const failedClone = Symbol("kordynV2.aiContext.failedClone");
const hasOwn = (value, key) => Boolean(value && Object.hasOwn(value, key));
const nonEmptyText = (value) => typeof value === "string" && value.trim().length > 0;
const canonicalIdentifier = (value) => nonEmptyText(value)
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value);

function arrayClassification(value) {
  try { return Array.isArray(value); } catch { return null; }
}

const list = (value) => arrayClassification(value) === true ? value : [];

function plainRecord(value) {
  if (!value || typeof value !== "object") return false;
  const array = arrayClassification(value);
  if (array !== false) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function cloneValue(value, seen) {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
  if (!["object", "function"].includes(typeof value)) return failedClone;
  if (seen.has(value)) return seen.get(value);
  const fail = () => {
    seen.set(value, failedClone);
    return failedClone;
  };
  const array = arrayClassification(value);
  if (array === null) return fail();
  if (array) {
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail(); }
    const lengthDescriptor = Object.hasOwn(descriptors, "length") ? descriptors.length : null;
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
    if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) return fail();
    const copy = new Array(length);
    seen.set(value, copy);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === "length") continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) continue;
      const index = typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1;
      if (!Number.isInteger(index) || index < 0 || index >= length) continue;
      const child = cloneValue(descriptor.value, seen);
      if (child === failedClone) continue;
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true
      });
    }
    return copy;
  }
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return fail(); }
  if (prototype !== Object.prototype && prototype !== null) return fail();
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail(); }
  const copy = Object.create(null);
  seen.set(value, copy);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) continue;
    const child = cloneValue(descriptor.value, seen);
    if (child === failedClone) continue;
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: child,
      writable: true
    });
  }
  return copy;
}

function cloneData(value) {
  const cloned = cloneValue(value, new WeakMap());
  return cloned === failedClone ? undefined : cloned;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function ownCanonicalIdentifier(value, key) {
  return plainRecord(value) && hasOwn(value, key) && canonicalIdentifier(value[key]) ? value[key] : null;
}

function fingerprintPrimitive(value) {
  if (value === null) return "n;";
  if (value === undefined) return "u;";
  if (typeof value === "string") return `s${value.length}:${value}`;
  if (typeof value === "boolean") return value ? "b1;" : "b0;";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "dNaN;";
    if (value === Infinity) return "d+Inf;";
    if (value === -Infinity) return "d-Inf;";
    if (Object.is(value, -0)) return "d-0;";
    return `d${value};`;
  }
  if (typeof value === "bigint") return `g${value};`;
  return `x${typeof value};`;
}

function canonicalFingerprint(root) {
  const chunks = [];
  const seen = new WeakMap();
  let nextReference = 0;
  const stack = [{ kind: "value", value: root }];
  try {
    while (stack.length) {
      const frame = stack.pop();
      if (frame.kind === "text") {
        chunks.push(frame.value);
        continue;
      }
      const value = frame.value;
      if (value === null || typeof value !== "object") {
        chunks.push(fingerprintPrimitive(value));
        continue;
      }
      if (seen.has(value)) {
        chunks.push(`r${seen.get(value)};`);
        continue;
      }
      const reference = nextReference;
      nextReference += 1;
      seen.set(value, reference);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const array = arrayClassification(value);
      if (array === null) {
        chunks.push(`x-array-${reference};`);
        continue;
      }
      if (array) {
        const lengthDescriptor = Object.hasOwn(descriptors, "length") ? descriptors.length : null;
        const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
        if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) {
          chunks.push(`x-length-${reference};`);
          continue;
        }
        chunks.push(`a${reference}:${length}[`);
        stack.push({ kind: "text", value: "]" });
        for (let index = length - 1; index >= 0; index -= 1) {
          const descriptor = descriptors[index];
          if (!descriptor) stack.push({ kind: "text", value: "h;" });
          else if (!descriptor.enumerable || !("value" in descriptor)) stack.push({ kind: "text", value: "x;" });
          else {
            stack.push({ kind: "value", value: descriptor.value });
            stack.push({ kind: "text", value: "i:" });
          }
        }
        continue;
      }
      const keys = Reflect.ownKeys(descriptors)
        .filter((key) => typeof key === "string" && descriptors[key].enumerable && "value" in descriptors[key])
        .sort();
      chunks.push(`o${reference}:${keys.length}{`);
      stack.push({ kind: "text", value: "}" });
      for (let offset = keys.length - 1; offset >= 0; offset -= 1) {
        const key = keys[offset];
        stack.push({ kind: "value", value: descriptors[key].value });
        stack.push({ kind: "text", value: `k${key.length}:${key}=` });
      }
    }
  } catch {
    return "x-fingerprint;";
  }
  return chunks.join("");
}

function validEventInput(row) {
  return plainRecord(row) && [row.title, row.shortTitle, row.name].some(nonEmptyText);
}

function eventIdentity(row) {
  return ownCanonicalIdentifier(row, "id") || ownCanonicalIdentifier(row, "eventId");
}

function eventMoment(row) {
  if (hasOwn(row, "due") && row.due) return row.due;
  return hasOwn(row, "startAt") ? row.startAt : null;
}

function eventLabels(row) {
  return [hasOwn(row, "title") ? row.title : null, hasOwn(row, "shortTitle") ? row.shortTitle : null]
    .filter(nonEmptyText);
}

function sameEventTruth(left, right) {
  if (eventMoment(left) !== eventMoment(right)) return false;
  const rightLabels = eventLabels(right);
  return eventLabels(left).some((label) => rightLabels.includes(label));
}

function normalizedEventCandidate(row, provenance) {
  try {
    const normalized = buildEventRows(provenance === "official"
      ? { marketCalendarEvents: [row] }
      : { events: [row] });
    return plainRecord(normalized[0])
      ? { provenance, row: normalized[0], fingerprint: canonicalFingerprint(normalized[0]) }
      : null;
  } catch {
    return null;
  }
}

function identitySet(candidates) {
  return new Set(candidates.map((candidate) => eventIdentity(candidate.row)).filter((identity) => identity !== null));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEventCandidates(left, right) {
  const provenanceOrder = Number(left.provenance !== "canonical") - Number(right.provenance !== "canonical");
  if (provenanceOrder !== 0) return provenanceOrder;
  const leftIdentity = eventIdentity(left.row);
  const rightIdentity = eventIdentity(right.row);
  const identityPresenceOrder = Number(leftIdentity === null) - Number(rightIdentity === null);
  if (identityPresenceOrder !== 0) return identityPresenceOrder;
  const identityOrder = compareText(leftIdentity || "", rightIdentity || "");
  return identityOrder !== 0 ? identityOrder : compareText(left.fingerprint, right.fingerprint);
}

function selectEventCandidate(group) {
  const ordered = group.slice().sort(compareEventCandidates);
  const canonical = ordered.filter((candidate) => candidate.provenance === "canonical");
  const official = ordered.filter((candidate) => candidate.provenance === "official");
  const mirrors = canonical.filter((candidate) => official.some((officialCandidate) => {
    const officialId = eventIdentity(officialCandidate.row);
    return officialId !== null
      && hasOwn(candidate.row, "scheduledKey")
      && candidate.row.scheduledKey === `official_${officialId}`;
  }));
  if (mirrors.length) {
    const identities = identitySet(mirrors);
    if (identities.size === 1) {
      const identity = identities.values().next().value;
      return { candidate: mirrors.find((item) => eventIdentity(item.row) === identity), identity };
    }
    if (identities.size > 1) return { candidate: mirrors[0], identity: null };
  }
  const officialIdentities = identitySet(official);
  if (officialIdentities.size === 1) {
    const identity = officialIdentities.values().next().value;
    return { candidate: official.find((item) => eventIdentity(item.row) === identity), identity };
  }
  if (officialIdentities.size > 1) return { candidate: ordered[0], identity: null };
  const canonicalIdentities = identitySet(canonical);
  if (canonicalIdentities.size === 1) {
    const identity = canonicalIdentities.values().next().value;
    return { candidate: canonical.find((item) => eventIdentity(item.row) === identity), identity };
  }
  if (canonicalIdentities.size > 1) return { candidate: ordered[0], identity: null };
  return { candidate: ordered[0], identity: null };
}

function reconcileEventRows(events, officialEvents) {
  const candidates = [
    ...events.map((row) => normalizedEventCandidate(row, "canonical")),
    ...officialEvents.map((row) => normalizedEventCandidate(row, "official"))
  ].filter(Boolean).sort(compareEventCandidates);
  const parents = candidates.map((unused, index) => index);
  const findRoot = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (!sameEventTruth(candidates[left].row, candidates[right].row)) continue;
      const leftRoot = findRoot(left);
      const rightRoot = findRoot(right);
      if (leftRoot !== rightRoot) {
        const root = Math.min(leftRoot, rightRoot);
        parents[leftRoot] = root;
        parents[rightRoot] = root;
      }
    }
  }
  const grouped = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = findRoot(index);
    const group = grouped.get(root) || [];
    group.push(candidates[index]);
    grouped.set(root, group);
  }
  const groups = Array.from(grouped.values())
    .map((group) => group.sort(compareEventCandidates))
    .sort((left, right) => compareEventCandidates(left[0], right[0]));
  const identityGroupCounts = new Map();
  for (const group of groups) {
    for (const identity of identitySet(group)) {
      identityGroupCounts.set(identity, (identityGroupCounts.get(identity) || 0) + 1);
    }
  }
  return groups.map((group) => {
    const selected = selectEventCandidate(group);
    const identity = selected.identity !== null && identityGroupCounts.get(selected.identity) === 1
      ? selected.identity
      : null;
    return { row: selected.candidate.row, identity };
  });
}

function projectFact(row, { id, kind, source }) {
  const safeRow = cloneData(row);
  const canonicalId = canonicalIdentifier(id) ? id : null;
  return {
    ...(plainRecord(safeRow) ? safeRow : {}),
    provider: nonEmptyText(safeRow?.sourceName) ? safeRow.sourceName : nonEmptyText(safeRow?.source) ? safeRow.source : null,
    id: canonicalId,
    identity: canonicalId || unavailable,
    kind,
    source,
    selectable: canonicalId !== null
  };
}

function applyUniqueSelection(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (canonicalIdentifier(row.id)) counts.set(row.id, (counts.get(row.id) || 0) + 1);
  }
  return rows.map((row) => deepFreeze({
    ...row,
    selectable: canonicalIdentifier(row.id) && counts.get(row.id) === 1
  }));
}

export function buildAiContextFacts(data = {}, { trustedSnapshot = false } = {}) {
  // `trustedSnapshot` is reserved for buildAiDomainModel's descriptor-safe clone.
  // Selection and every other caller must keep the default raw-data containment path.
  const safeData = trustedSnapshot ? data : cloneData(data);
  const source = plainRecord(safeData) ? safeData : {};
  const eventInput = list(source.events).map((row) => cloneData(row)).filter(validEventInput);
  const officialEventInput = list(source.marketCalendarEvents).map((row) => cloneData(row)).filter(validEventInput);
  const events = reconcileEventRows(eventInput, officialEventInput)
    .map(({ row, identity }) => deepFreeze(projectFact(row, { id: identity, kind: "event", source: "events" })));
  const news = list(source.newsFeed)
    .filter(plainRecord)
    .map((row) => projectFact(row, { id: ownCanonicalIdentifier(row, "id"), kind: "news", source: "newsFeed" }));
  const movers = list(source.marketMovers?.movers)
    .filter(plainRecord)
    .map((row) => projectFact(row, {
      id: ownCanonicalIdentifier(row, "id") || ownCanonicalIdentifier(row, "instId") || ownCanonicalIdentifier(row, "symbol"),
      kind: "market_mover",
      source: "marketMovers.movers"
    }));
  const knowledgeSource = arrayClassification(source.knowledge) === true ? source.knowledge : list(source.knowledge?.sources);
  const knowledge = knowledgeSource
    .filter(plainRecord)
    .map((row) => projectFact(row, { id: ownCanonicalIdentifier(row, "id"), kind: "knowledge", source: "knowledge" }));
  const signals = applyUniqueSelection([...news, ...movers, ...knowledge]);
  const watchRows = list(source.watchTriggers).filter(plainRecord).map((row) => {
    const id = ownCanonicalIdentifier(row, "id");
    return { ...cloneData(row), id, identity: id || unavailable, selectable: id !== null };
  });
  const watches = applyUniqueSelection(watchRows);
  return Object.freeze({
    intelligence: Object.freeze([...signals.slice(0, news.length), ...events, ...signals.slice(news.length)]),
    signals: Object.freeze(signals),
    watches: Object.freeze(watches),
    events: Object.freeze(events)
  });
}

export function canonicalAiContextRow(data, type, id) {
  if (!canonicalIdentifier(id)) return null;
  const facts = buildAiContextFacts(data);
  const rows = type === "Signal" ? facts.signals : type === "Watch" ? facts.watches : type === "Event" ? facts.events : [];
  const matches = rows.filter((row) => row.id === id && row.selectable === true);
  return matches.length === 1 ? matches[0] : null;
}
