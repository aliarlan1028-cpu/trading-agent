const jsonResponseMaterializations = new WeakSet();

const isObjectLike = (value) => value !== null && typeof value === "object";

// This is a capability boundary, not an arbitrary-object validator. Call it
// only with a value returned by JSON parsing or with a deliberately controlled
// fixture. JSON parsing cannot create accessors or Proxies; descriptor traversal
// keeps controlled accessor fixtures inert while branding their data children.
export function materializeJsonResponse(root) {
  if (!isObjectLike(root)) return root;
  const pending = [root];
  const materialized = [];
  const visited = new WeakSet();
  while (pending.length) {
    const value = pending.pop();
    if (!isObjectLike(value) || visited.has(value)) continue;
    visited.add(value);
    materialized.push(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, "value") && isObjectLike(descriptor.value)) {
        pending.push(descriptor.value);
      }
    }
  }
  for (const value of materialized) jsonResponseMaterializations.add(value);
  return root;
}

export function hasJsonResponseProvenance(value) {
  return isObjectLike(value) && jsonResponseMaterializations.has(value);
}
