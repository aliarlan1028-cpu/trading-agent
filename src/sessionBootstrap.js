export function initialAuthRequired({ native, token }) {
  return native ? !String(token || "").trim() : true;
}

export function shouldBootstrapCoreOnMount({ native, token }) {
  return native ? Boolean(String(token || "").trim()) : true;
}
