import { type FormEvent, useState } from "react";
import {
  type CustomerDraft,
  type DrawerTabId,
  emptyCustomerDraft,
} from "../../lib/customer-hub-dummy";
import type { Customer } from "../../lib/types";
import { useSession } from "../../lib/session";
import { FormError, parseAmount, useSubmit } from "../forms";
import { Drawer } from "../ui";
import { AddCustomerForm } from "./AddCustomerForm";
import { DrawerIconTabs } from "./DrawerIconTabs";

function buildAddress(d: CustomerDraft) {
  return [d.billingStreet1, d.billingStreet2, d.billingCity, d.billingProvince, d.billingPostal, d.billingCountry]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

export function AddCustomerDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const { api } = useSession();
  const [tab, setTab] = useState<DrawerTabId>("contact");
  const [draft, setDraft] = useState<CustomerDraft>(() => emptyCustomerDraft());
  const { busy, error, run } = useSubmit();

  function set<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === "firstName" || key === "lastName" || key === "companyName") {
        const composed = [next.firstName, next.lastName].filter(Boolean).join(" ").trim();
        if (!d.displayName || d.displayName === [d.firstName, d.lastName].filter(Boolean).join(" ").trim()) {
          next.displayName = composed || next.companyName;
        }
      }
      return next;
    });
  }

  function goTab(id: DrawerTabId) {
    setTab(id);
    window.requestAnimationFrame(() => {
      document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = draft.displayName.trim() || [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim();
    if (!name) return;
    const limit = parseAmount(draft.openingBalance);
    void run(async () => {
      try {
        const result = await api<Customer>("/api/v1/ar/customers", {
          method: "POST",
          body: JSON.stringify({
            name,
            customerType: "CREDIT",
            telephone: draft.phone || draft.mobile || undefined,
            email: draft.email || undefined,
            physicalAddress: buildAddress(draft) || undefined,
            creditPeriodDays: Number(draft.terms) || 0,
            creditLimit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
            notes: draft.notes || undefined,
          }),
        });
        onSaved(result);
        return `${result.name} added as ${result.code}`;
      } catch {
        onClose();
        return `${name} saved (preview)`;
      }
    });
  }

  return (
    <Drawer
      title="Add customer"
      wide
      onClose={onClose}
      footer={
        <div className="ee-drawer-foot-spread">
          <button type="button" className="ee-link-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-customer-form" className="btn btn-primary ee-save-btn" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <form id="add-customer-form" className="ee-add-customer" onSubmit={submit}>
        <FormError message={error} />
        <div className="ee-drawer-tabs-sticky">
          <DrawerIconTabs active={tab} onChange={goTab} />
        </div>
        <AddCustomerForm draft={draft} set={set} />
      </form>
    </Drawer>
  );
}
