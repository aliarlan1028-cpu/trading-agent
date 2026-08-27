const locations = new WeakSet();
const states = new WeakSet();
const selections = new WeakSet();
const selectionParts = new WeakSet();
const contexts = new WeakSet();
const navigableContexts = new WeakSet();
const destinations = new WeakSet();

const objectLike = (value) => value !== null && typeof value === "object";
const register = (registry, value) => {
  if (objectLike(value)) registry.add(value);
  return value;
};

export const registerAiSupportLocation = (value) => register(locations, value);
export const isAiSupportLocation = (value) => objectLike(value) && locations.has(value);

export const registerAiSupportState = (value) => register(states, value);
export const isAiSupportState = (value) => objectLike(value) && states.has(value);

export function registerAiSupportSelection(value, object, context) {
  register(selections, value);
  register(selectionParts, object);
  register(selectionParts, context);
  return value;
}
export const isAiSupportSelection = (value) => objectLike(value) && selections.has(value);
export const isAiSupportSelectionPart = (value) => objectLike(value) && selectionParts.has(value);

export function registerAiSupportContext(value, { navigable = false } = {}) {
  register(contexts, value);
  if (navigable) register(navigableContexts, value);
  return value;
}
export const isAiSupportContext = (value) => objectLike(value) && contexts.has(value);
export const isAiSupportNavigableContext = (value) => objectLike(value) && navigableContexts.has(value);

export const registerAiSupportDestination = (value) => register(destinations, value);
export const isAiSupportDestination = (value) => objectLike(value) && destinations.has(value);
