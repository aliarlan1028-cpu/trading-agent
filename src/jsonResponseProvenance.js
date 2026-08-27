const jsonResponseRecords = new WeakSet();

const isObjectLike = (value) => value !== null && typeof value === "object";

function registerRecord(value) {
  if (isObjectLike(value)) jsonResponseRecords.add(value);
  return value;
}

function registerFreshJsonGraph(root) {
  if (!isObjectLike(root)) return root;
  const pending = [root];
  const visited = new WeakSet();
  while (pending.length) {
    const value = pending.pop();
    if (!isObjectLike(value) || visited.has(value)) continue;
    visited.add(value);
    registerRecord(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, "value") && isObjectLike(descriptor.value)) {
        pending.push(descriptor.value);
      }
    }
  }
  return root;
}

// Response.json() creates a fresh JSON graph. Register it at that parse boundary,
// before application code can publish or mutate any part of the response.
export async function parseJsonResponse(response) {
  return registerFreshJsonGraph(await response.json());
}

// Text loaders and event streams parse and register in the same synchronous step.
export function parseJsonResponseText(text) {
  return registerFreshJsonGraph(JSON.parse(text));
}

// Projection code may create new trusted containers. These constructors never
// accept an existing object to brand and never confer trust on nested values.
export function createJsonProjectionRecord(prototype = Object.prototype) {
  const selectedPrototype = prototype === null ? null : Object.prototype;
  return registerRecord(Object.create(selectedPrototype));
}

export function createJsonProjectionArray() {
  return registerRecord([]);
}

export function projectJsonResponseRecord(...sources) {
  const target = createJsonProjectionRecord();
  for (const source of sources) {
    if (!hasJsonResponseProvenance(source) || Array.isArray(source)) continue;
    for (const key of Reflect.ownKeys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: descriptor.value
      });
    }
  }
  return target;
}

export function jsonResponseArrayValues(value) {
  if (!hasJsonResponseProvenance(value) || !Array.isArray(value)) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : -1;
  if (!Number.isSafeInteger(length) || length < 0) return null;
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    values.push(descriptor.value);
  }
  return values;
}

export function hasJsonResponseProvenance(value) {
  return isObjectLike(value) && jsonResponseRecords.has(value);
}
