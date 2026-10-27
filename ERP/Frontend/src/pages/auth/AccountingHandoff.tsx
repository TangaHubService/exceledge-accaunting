import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { safeAccountingHandoffPath } from "../../lib/accounting-handoff";

export default function AccountingHandoff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const next = safeAccountingHandoffPath(`/accounting-handoff?${params.toString()}`);
    if (!next) {
      setError("This return address is not allowed.");
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
      return;
    }
    const ret = new URLSearchParams(next.split("?")[1] || "").get("return");
    if (!ret) {
      setError("Missing return address.");
      return;
    }
    window.location.replace(`${ret.replace(/\/$/, "")}/#access_token=${encodeURIComponent(token)}`);
  }, [navigate, params]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-gray-600">{error || "Connecting your Excel Edge session to Accounting…"}</p>
    </div>
  );
}
