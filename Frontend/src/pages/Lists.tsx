import { navigate } from "../lib/router";

interface ListItem {
  id: string;
  title: string;
  description: string;
  to: string;
}

const LEFT_LIST_ITEMS: ListItem[] = [
  {
    id: "chart-of-accounts",
    title: "Chart of Accounts",
    description:
      "View and manage accounts for assets, liabilities, income and expenses. Add or edit accounts to organise your transactions.",
    to: "/accounting/chart-of-accounts",
  },
  {
    id: "recurring-transactions",
    title: "Recurring Transactions",
    description:
      "Manage transactions saved for reuse. Schedule automatic entries, set reminders, or keep templates for later.",
    to: "/accounting/recurring-transactions",
  },
  {
    id: "products-and-services",
    title: "Products and Services",
    description:
      "View and edit the products and services you sell, including descriptions and selling rates.",
    to: "/products-services",
  },
  {
    id: "product-categories",
    title: "Product Categories",
    description:
      "Group products and services to organise your catalogue and simplify sales forms.",
    to: "/inventory",
  },
  {
    id: "locations",
    title: "Locations",
    description:
      "Categorise transactions by branch, site, or other parts of your company.",
    to: "/branches",
  },
  {
    id: "custom-fields",
    title: "Custom Fields",
    description:
      "Add fields to your forms to capture, sort, track and report the business information that matters to you.",
    to: "/settings/custom-fields",
  },
];

const RIGHT_LIST_ITEMS: ListItem[] = [
  {
    id: "payment-methods",
    title: "Payment Methods",
    description:
      "Manage cash, cheque, bank transfer, mobile money and other payment methods used by your customers.",
    to: "/banking",
  },
  {
    id: "terms",
    title: "Terms",
    description:
      "Set payment due dates for customers and suppliers, including early payment discounts.",
    to: "/settings/company",
  },
  {
    id: "classes",
    title: "Classes",
    description:
      "Categorise accounting transactions to track business activities and performance.",
    to: "/dimensions",
  },
  {
    id: "attachments",
    title: "Attachments",
    description:
      "View, add, edit, download and export uploaded documents, and find the transactions linked to them.",
    to: "/attachments",
  },
];

export function Lists() {
  return (
    <div className="ee-lists-container">
      <div className="ee-lists-header">
        <h1 className="ee-lists-title">All lists</h1>
        <p className="ee-lists-subtitle">Manage your business lists and preferences.</p>
      </div>

      <div className="ee-lists-grid-2col">
        {/* Left Column */}
        <div className="ee-lists-col">
          {LEFT_LIST_ITEMS.map((item) => (
            <div key={item.id} className="ee-lists-item">
              <a
                href={item.to}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.to);
                }}
                className="ee-lists-item-link"
              >
                {item.title}
              </a>
              <p className="ee-lists-item-desc">{item.description}</p>
            </div>
          ))}
        </div>

        {/* Right Column */}
        <div className="ee-lists-col">
          {RIGHT_LIST_ITEMS.map((item) => (
            <div key={item.id} className="ee-lists-item">
              <a
                href={item.to}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.to);
                }}
                className="ee-lists-item-link"
              >
                {item.title}
              </a>
              <p className="ee-lists-item-desc">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
