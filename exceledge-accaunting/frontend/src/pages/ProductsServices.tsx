import { Check, ChevronDown, ChevronUp, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link } from "../lib/router";

export function ProductsServices() {
  const { toast } = useFeedback();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Drawer form state
  const [basicInfoOpen, setBasicInfoOpen] = useState(true);
  const [salesOpen, setSalesOpen] = useState(true);
  const [purchasingOpen, setPurchasingOpen] = useState(true);

  const [serviceName, setServiceName] = useState("");
  const [itemType, setItemType] = useState("Service");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");

  const [sellService, setSellService] = useState(true);
  const [salesDesc, setSalesDesc] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [incomeAccount, setIncomeAccount] = useState("Services");

  const [purchaseService, setPurchaseService] = useState(false);
  const [purchaseDesc, setPurchaseDesc] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [expenseAccount, setExpenseAccount] = useState("5000 Direct costs");

  function handleSave(andNew = false) {
    if (!serviceName.trim()) {
      toast("Please enter a service name");
      return;
    }
    toast(`Service "${serviceName}" saved successfully`);
    if (andNew) {
      setServiceName("");
      setSku("");
      setSalesDesc("");
      setSalesPrice("");
      setPurchaseCost("");
    } else {
      setDrawerOpen(false);
    }
  }

  return (
    <div className="ee-ps-container">
      {/* Breadcrumb matching mockup 59 */}
      <div className="ee-ps-breadcrumb">
        <Link to="/invoices">Sales &amp; Get Paid</Link>
        <span className="ee-ps-breadcrumb-sep">/</span>
        <span className="ee-ps-breadcrumb-curr">Products &amp; services</span>
      </div>

      <h1 className="ee-ps-page-title">Products &amp; services</h1>

      {/* Hero card matching mockup 59 & 60 */}
      <div className="ee-ps-hero-card">
        <div className="ee-ps-hero-content">
          <h2 className="ee-ps-hero-title">Get started with products and services</h2>
          <p className="ee-ps-hero-sub">Save time creating your next invoice by adding items.</p>

          <ul className="ee-ps-checklist">
            <li className="ee-ps-check-item">
              <span className="ee-ps-check-icon">
                <Check size={12} strokeWidth={3} />
              </span>
              <span>Categorise products and services to manage items efficiently</span>
            </li>
            <li className="ee-ps-check-item">
              <span className="ee-ps-check-icon">
                <Check size={12} strokeWidth={3} />
              </span>
              <span>Auto-fill transactions with saved item details</span>
            </li>
            <li className="ee-ps-check-item">
              <span className="ee-ps-check-icon">
                <Check size={12} strokeWidth={3} />
              </span>
              <span>Gain insight into your business performance with detailed reports</span>
            </li>
          </ul>

          <div className="ee-ps-hero-actions">
            <button
              type="button"
              className="ee-btn-primary-blue"
              onClick={() => setDrawerOpen(true)}
            >
              Create items
            </button>
            <button
              type="button"
              className="ee-btn-outline-blue"
              onClick={() => toast("Import products and services from CSV or Excel")}
            >
              Import items
            </button>
          </div>
        </div>

        <div className="ee-ps-hero-image-wrap">
          <img
            src="/illustrations/products-services-hero.png"
            alt="Products and services illustration"
            className="ee-ps-hero-img"
          />
        </div>
      </div>

      {/* Tips & Resources section matching mockup 60 */}
      <div className="ee-ps-resources">
        <h3 className="ee-ps-res-title">TIPS &amp; RESOURCES</h3>
        <a
          href="#batch-import"
          onClick={(e) => {
            e.preventDefault();
            toast("Opening batch import wizard…");
          }}
          className="ee-ps-res-link"
        >
          Got your products and services in a spreadsheet? Upload them using batch import
        </a>
      </div>

      {/* Drawer: Add a new service matching mockups 61 & 62 */}
      {drawerOpen && (
        <>
          <div className="ee-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="ee-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
            <div className="ee-drawer-header">
              <h2 id="drawer-title" className="ee-drawer-title">Add a new service</h2>
              <button
                type="button"
                className="ee-drawer-close-btn"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="ee-drawer-body">
              {/* Accordion 1: Basic info */}
              <div className="ee-accordion-section">
                <div
                  className="ee-accordion-header"
                  onClick={() => setBasicInfoOpen((o) => !o)}
                  role="button"
                  tabIndex={0}
                >
                  <h3 className="ee-accordion-title">Basic info</h3>
                  {basicInfoOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>

                {basicInfoOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                          <label className="ee-field-label">Name*</label>
                          <input
                            type="text"
                            className="ee-input-text"
                            value={serviceName}
                            onChange={(e) => setServiceName(e.target.value)}
                            placeholder=""
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="ee-field-label">Item type</label>
                          <select
                            className="ee-input-select"
                            value={itemType}
                            onChange={(e) => setItemType(e.target.value)}
                          >
                            <option value="Service">Service</option>
                            <option value="Inventory">Inventory</option>
                            <option value="Non-inventory">Non-inventory</option>
                            <option value="Bundle">Bundle</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ marginTop: 20 }}>
                        <div
                          className="ee-image-upload-box"
                          onClick={() => toast("Image upload prompt")}
                          title="Add an image"
                        >
                          <ImageIcon size={28} strokeWidth={1.5} />
                          <span>Add an image</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="ee-field-label">SKU</label>
                      <input
                        type="text"
                        className="ee-input-text"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        placeholder=""
                      />
                    </div>

                    <div>
                      <label className="ee-field-label">Category</label>
                      <select
                        className="ee-input-select"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">Select a category</option>
                        <option value="Consulting">Consulting</option>
                        <option value="Accounting & Bookkeeping">Accounting &amp; Bookkeeping</option>
                        <option value="Design & Creative">Design &amp; Creative</option>
                        <option value="IT Services">IT Services</option>
                        <option value="Maintenance">Maintenance</option>
                        <option value="Training">Training</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Accordion 2: Sales (Mockup 62) */}
              <div className="ee-accordion-section">
                <div
                  className="ee-accordion-header"
                  onClick={() => setSalesOpen((o) => !o)}
                  role="button"
                  tabIndex={0}
                >
                  <h3 className="ee-accordion-title">Sales</h3>
                  {salesOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>

                {salesOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <label className="ee-checkbox-row" onClick={() => setSellService((s) => !s)}>
                      <div className={`ee-checkbox-box ${sellService ? "checked" : ""}`}>
                        {sellService && <Check size={14} strokeWidth={3} />}
                      </div>
                      <span>I sell this service to my customers</span>
                    </label>

                    {sellService && (
                      <>
                        <div>
                          <label className="ee-field-label">Description</label>
                          <textarea
                            className="ee-input-text"
                            style={{ height: 84, resize: "vertical", fontFamily: "inherit" }}
                            value={salesDesc}
                            onChange={(e) => setSalesDesc(e.target.value)}
                            placeholder=""
                          />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                          <div>
                            <label className="ee-field-label">Price/rate (RWF)</label>
                            <input
                              type="number"
                              className="ee-input-text"
                              value={salesPrice}
                              onChange={(e) => setSalesPrice(e.target.value)}
                              placeholder=""
                            />
                          </div>
                          <div>
                            <label className="ee-field-label">Income account*</label>
                            <select
                              className="ee-input-select"
                              value={incomeAccount}
                              onChange={(e) => setIncomeAccount(e.target.value)}
                            >
                              <option value="Services">Services</option>
                              <option value="4000 Sales">4000 Sales</option>
                              <option value="4100 Service income">4100 Service income</option>
                              <option value="4200 Consulting income">4200 Consulting income</option>
                              <option value="4900 Other income">4900 Other income</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 3: Purchasing (Mockup 62) */}
              <div className="ee-accordion-section">
                <div
                  className="ee-accordion-header"
                  onClick={() => setPurchasingOpen((o) => !o)}
                  role="button"
                  tabIndex={0}
                >
                  <h3 className="ee-accordion-title">Purchasing</h3>
                  {purchasingOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>

                {purchasingOpen && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <label className="ee-checkbox-row" onClick={() => setPurchaseService((s) => !s)}>
                      <div className={`ee-checkbox-box ${purchaseService ? "checked" : ""}`}>
                        {purchaseService && <Check size={14} strokeWidth={3} />}
                      </div>
                      <span>I purchase this service from a supplier</span>
                    </label>

                    {purchaseService && (
                      <>
                        <div>
                          <label className="ee-field-label">Purchase Description</label>
                          <textarea
                            className="ee-input-text"
                            style={{ height: 84, resize: "vertical", fontFamily: "inherit" }}
                            value={purchaseDesc}
                            onChange={(e) => setPurchaseDesc(e.target.value)}
                            placeholder=""
                          />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                          <div>
                            <label className="ee-field-label">Cost/rate (RWF)</label>
                            <input
                              type="number"
                              className="ee-input-text"
                              value={purchaseCost}
                              onChange={(e) => setPurchaseCost(e.target.value)}
                              placeholder=""
                            />
                          </div>
                          <div>
                            <label className="ee-field-label">Expense account*</label>
                            <select
                              className="ee-input-select"
                              value={expenseAccount}
                              onChange={(e) => setExpenseAccount(e.target.value)}
                            >
                              <option value="5000 Direct costs">5000 Direct costs</option>
                              <option value="6100 Subscriptions">6100 Subscriptions</option>
                              <option value="6200 Professional fees">6200 Professional fees</option>
                              <option value="6300 Subcontractors">6300 Subcontractors</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="ee-drawer-footer">
              <button
                type="button"
                className="ee-btn-ghost-cancel"
                onClick={() => setDrawerOpen(false)}
              >
                Cancel
              </button>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  className="ee-btn-outline-blue"
                  onClick={() => handleSave(true)}
                >
                  Save and new
                </button>
                <button
                  type="button"
                  className="ee-btn-primary-blue"
                  onClick={() => handleSave(false)}
                >
                  Save and close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
