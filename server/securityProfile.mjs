export const SECURITY_PROFILES = Object.freeze({
  hardened: "external_hardened",
  bitlaunchSingleServer: "bitlaunch_single_server"
});

export function productionSecurityProfile(env = process.env) {
  const raw = String(env.PRODUCTION_SECURITY_PROFILE || SECURITY_PROFILES.hardened).trim().toLowerCase();
  if ([SECURITY_PROFILES.bitlaunchSingleServer, "single_server", "bitlaunch"].includes(raw)) {
    return SECURITY_PROFILES.bitlaunchSingleServer;
  }
  return SECURITY_PROFILES.hardened;
}

export function requiresExternalSecurityInfrastructure(env = process.env) {
  return productionSecurityProfile(env) === SECURITY_PROFILES.hardened;
}
