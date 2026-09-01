import { ACCOUNT_STATE_SURFACES } from "../domains/account/stateSurfaces.js";
import { AI_STATE_SURFACES } from "../domains/ai/stateSurfaces.js";
import { ASSET_STATE_SURFACES } from "../domains/assets/stateSurfaces.js";
import { GOVERNANCE_STATE_SURFACES } from "../domains/governance/stateSurfaces.js";

export const KORDYN_V2_STATE_SURFACES = Object.freeze({
  ai: AI_STATE_SURFACES,
  account: ACCOUNT_STATE_SURFACES,
  assets: ASSET_STATE_SURFACES,
  governance: GOVERNANCE_STATE_SURFACES
});
