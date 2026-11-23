import { type AccountingCapability, hasCapability } from "@exceledge/accounting-domain";

/**
 * Permission check for service code that receives an actor instead of the request. Actors built
 * from a request carry the person's effective capabilities (custom role or ERP role); older
 * callers that only pass `erpRole` fall back to the built-in role.
 */
export function actorCan(actor: { erpRole?: string; capabilities?: readonly string[] }, capability: AccountingCapability) {
  return actor.capabilities ? actor.capabilities.includes(capability) : hasCapability(actor.erpRole, capability);
}
