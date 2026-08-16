export function nextResourceRequest(current = {}, resource) {
  return {
    resource: String(resource || ""),
    generation: Number(current.generation || 0) + 1
  };
}

export function resourceRequestIsCurrent(current = {}, request = {}) {
  return String(current.resource || "") === String(request.resource || "")
    && Number(current.generation || 0) === Number(request.generation || 0);
}
