import { type FormEvent, useState } from "react";
import {
  emptySupplierDraft,
  type SupplierDraft,
  type SupplierDrawerTabId,
} from "../../lib/supplier-hub-dummy";
import type { Supplier } from "../../lib/types";
import { useSession } from "../../lib/session";
import { supplierSchema, useYupForm } from "../../lib/validation";
import { FormError, parseAmount, useSubmit } from "../forms";
import { Drawer } from "../ui";
import { AddSupplierForm } from "./AddSupplierForm";
import { SupplierDrawerTabs } from "./SupplierDrawerTabs";

function buildAddress(d: SupplierDraft) {
  return [d.street1, d.street2, d.city, d.province, d.postal, d.country]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

export function AddSupplierDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const { api } = useSession();
  const [tab, setTab] = useState<SupplierDrawerTabId>("contact");
  const [draft, setDraft] = useState<SupplierDraft>(() => emptySupplierDraft());
  const { busy, error, run } = useSubmit();
  const { showError, blurField, validate } = useYupForm(supplierSchema, draft, setDraft);

  function set<K extends keyof SupplierDraft>(key: K, value: SupplierDraft[K]) {
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

  function goTab(id: SupplierDrawerTabId) {
    setTab(id);
    window.requestAnimationFrame(() => {
      document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await validate();
    if (!ok) {
      setTab("contact");
      return;
    }
    const name = draft.displayName.trim() || [draft.firstName, draft.lastName].filter(Boolean).join(" ").trim() || draft.companyName.trim();
    if (!name) return;
    const opening = parseAmount(draft.openingBalance);
    void run(async () => {
      try {
        const result = await api<Supplier>("/api/v1/ap/suppliers", {
          method: "POST",
          body: JSON.stringify({
            name,
            telephone: draft.phone || draft.mobile || undefined,
            email: draft.email || undefined,
            physicalAddress: buildAddress(draft) || undefined,
            creditPeriodDays: Number(draft.terms) || 0,
            notes: draft.notes || undefined,
            tin: draft.businessId || undefined,
            openingBalance: Number.isFinite(opening) ? opening : undefined,
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
      title="Add supplier"
      wide
      onClose={onClose}
      footer={
        <div className="ee-drawer-foot-spread">
          <button type="button" className="ee-link-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-supplier-form" className="btn btn-primary ee-save-btn" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <form id="add-supplier-form" className="ee-add-customer" onSubmit={(e) => void submit(e)} noValidate>
        <FormError message={error} />
        <div className="ee-drawer-tabs-sticky">
          <SupplierDrawerTabs active={tab} onChange={goTab} />
        </div>
        <AddSupplierForm
          draft={draft}
          set={set}
          errors={{
            displayName: showError("displayName"),
            email: showError("email"),
            website: showError("website"),
          }}
          onBlurField={(key) => blurField(key)}
        />
      </form>
    </Drawer>
  );
}
