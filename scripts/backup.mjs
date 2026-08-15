import { createVerifiedBackup } from "../server/backupService.mjs";

const result = await createVerifiedBackup();
console.log(JSON.stringify({
  status: result.status,
  verified: result.verified,
  integrity: result.integrity,
  sqliteFile: result.sqliteFile,
  encryptedFile: result.encryptedFile,
  offsiteFile: result.offsiteFile,
  bytes: result.bytes,
  sha256: result.sha256,
  retention: result.retention,
  completedAt: result.completedAt
}, null, 2));
