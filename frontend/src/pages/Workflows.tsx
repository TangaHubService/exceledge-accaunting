import {
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Filter,
  type LucideIcon,
  MessageSquare,
  Plus,
  Receipt,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "../lib/ribbon-dummy";

const SW = 1.5;

const ICONS: Record<WorkflowTemplate["icon"], LucideIcon> = {
  file: FileText,
  chart: BarChart3,
  clock: Clock,
  bank: Building2,
  user: UserRound,
  plane: Send,
  bill: Receipt,
  card: CreditCard,
  building: Building2,
  check: CheckCircle2,
};

type Tab = "templates" | "mine" | "history";

export function Workflows() {
  const [tab, setTab] = useState<Tab>("templates");
  const [query, setQuery] = useState("");

  const templates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return WORKFLOW_TEMPLATES;
    return WORKFLOW_TEMPLATES.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <div className="ee-workflows">
      <header className="ee-workflows-hero">
        <div>
          <div className="ee-workflows-eyebrow">Automate your work</div>
          <h1>Workflow automation</h1>
          <p>Build consistent processes. Keep your team moving.</p>
        </div>
        <div className="ee-workflows-hero-links">
          <button type="button" className="ee-workflows-link">
            <BookOpen size={15} strokeWidth={SW} />
            Learn about workflows
          </button>
          <button type="button" className="ee-workflows-link">
            <MessageSquare size={15} strokeWidth={SW} />
            Give feedback
          </button>
        </div>
      </header>

      <div className="ee-workflows-tabs" role="tablist" aria-label="Workflow sections">
        {(
          [
            ["templates", "Templates"],
            ["mine", "My workflows"],
            ["history", "History"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`ee-workflows-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ee-workflows-toolbar">
        <label className="ee-workflows-search">
          <Search size={16} strokeWidth={SW} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search templates..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search templates"
          />
        </label>
        <button type="button" className="ee-workflows-filters">
          <Filter size={15} strokeWidth={SW} />
          Filters
        </button>
        <button type="button" className="ee-btn-primary ee-workflows-custom">
          <Plus size={16} strokeWidth={2.25} />
          Custom workflow
        </button>
      </div>

      {tab === "templates" && (
        <section className="ee-workflows-section" aria-label="Workflow templates">
          <h2>
            Workflow templates <span>{templates.length} templates</span>
          </h2>
          <div className="ee-workflows-grid">
            {templates.map((t) => {
              const Icon = ICONS[t.icon];
              return (
                <article key={t.id} className="ee-workflow-card">
                  <span className="ee-workflow-card-icon" aria-hidden="true">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <h3>{t.title}</h3>
                  <p>{t.description}</p>
                  <div className="ee-workflow-card-foot">
                    <div className="ee-workflow-tags">
                      {t.tags.map((tag) => (
                        <span key={tag} className="ee-workflow-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button type="button" className="ee-workflow-use">
                      Use template →
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "mine" && (
        <div className="ee-workflows-empty-panel">
          <h3>No workflows yet</h3>
          <p>Use a template or create a custom workflow to get started.</p>
        </div>
      )}

      {tab === "history" && (
        <div className="ee-workflows-empty-panel">
          <h3>No history yet</h3>
          <p>Runs and activity for your workflows will appear here.</p>
        </div>
      )}
    </div>
  );
}
