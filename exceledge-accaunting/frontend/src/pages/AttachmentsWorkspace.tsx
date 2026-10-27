import {
  ChevronDown,
  ChevronLeft,
  FileText,
  Printer,
  Settings,
  UploadCloud,
} from "lucide-react";
import { useRef, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate } from "../lib/router";

export function AttachmentsWorkspace() {
  const { toast } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<
    Array<{
      id: string;
      name: string;
      type: string;
      size: string;
      note: string;
      uploaded: string;
      links: string;
    }>
  >([]);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const newAtt = {
      id: String(Date.now()),
      name: file.name,
      type: file.type.split("/")[1]?.toUpperCase() || "FILE",
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      note: "Uploaded from workspace",
      uploaded: "Just now",
      links: "—",
    };
    setAttachments((prev) => [newAtt, ...prev]);
    toast(`Attached ${file.name}`);
  }

  return (
    <div className="ee-att-container">
      <h1 className="ee-lists-title" style={{ margin: "0 0 14px" }}>
        Attachments
      </h1>

      <div className="ee-att-sub-bar">
        <a
          href="/lists"
          onClick={(e) => {
            e.preventDefault();
            navigate("/lists");
          }}
          className="ee-back-link"
        >
          <ChevronLeft size={16} />
          <span>All lists</span>
        </a>

        <div className="ee-att-shared-note">
          Looking for shared documents? Go to{" "}
          <a
            href="/accounting/my-accountant"
            onClick={(e) => {
              e.preventDefault();
              navigate("/accounting/my-accountant");
            }}
          >
            My accountant
          </a>
        </div>
      </div>

      {/* Upload Dropzone matching mockup 65 */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />
      <div
        className="ee-att-dropzone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) {
            const file = e.dataTransfer.files[0];
            const newAtt = {
              id: String(Date.now()),
              name: file.name,
              type: file.type.split("/")[1]?.toUpperCase() || "FILE",
              size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
              note: "Uploaded via dropzone",
              uploaded: "Just now",
              links: "—",
            };
            setAttachments((prev) => [newAtt, ...prev]);
            toast(`Attached ${file.name}`);
          }
        }}
      >
        <div className="ee-att-upload-icon">
          <UploadCloud size={24} />
        </div>
        <p className="ee-att-dropzone-title">Add attachment</p>
        <p className="ee-att-dropzone-sub">Max file size: 20 MB</p>
      </div>

      {/* Toolbar matching mockup 65 */}
      <div className="ee-table-toolbar">
        <button
          type="button"
          className="ee-btn-batch-actions"
          onClick={() => toast("Select attachments to run batch actions")}
        >
          <span>Batch Actions</span>
          <ChevronDown size={14} />
        </button>

        <div className="ee-toolbar-icons">
          <button
            type="button"
            className="ee-icon-btn"
            onClick={() => window.print()}
            title="Print"
          >
            <Printer size={18} />
          </button>
          <button
            type="button"
            className="ee-icon-btn"
            onClick={() => toast("Attachments table columns settings")}
            title="Table settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Table matching mockup 65 */}
      <div className="ee-mockup-table-wrap">
        <table className="ee-mockup-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" aria-label="Select all attachments" />
              </th>
              <th>THUMBNAIL</th>
              <th>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>TYPE</span>
                  <span style={{ fontSize: 10 }}>▲</span>
                </div>
              </th>
              <th>NAME</th>
              <th>SIZE</th>
              <th>NOTE</th>
              <th>UPLOADED</th>
              <th>LINKS</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {attachments.length === 0 ? (
              <tr className="ee-table-empty-row">
                <td colSpan={9}>
                  <div style={{ padding: "40px 0" }}>
                    <FileText size={48} strokeWidth={1} color="#94a3b8" />
                    <div style={{ marginTop: 12, color: "#334155", fontWeight: 500 }}>
                      No attachments yet
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              attachments.map((att) => (
                <tr key={att.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${att.name}`} />
                  </td>
                  <td>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        background: "#f1f5f9",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <FileText size={18} color="#64748b" />
                    </div>
                  </td>
                  <td>{att.type}</td>
                  <td>
                    <button
                      type="button"
                      className="ee-lists-item-link"
                      style={{ fontSize: 14 }}
                      onClick={() => toast(`Downloading ${att.name}…`)}
                    >
                      {att.name}
                    </button>
                  </td>
                  <td>{att.size}</td>
                  <td>{att.note}</td>
                  <td>{att.uploaded}</td>
                  <td>{att.links}</td>
                  <td>
                    <button
                      type="button"
                      className="ee-btn-ghost-cancel"
                      style={{ padding: "4px 8px" }}
                      onClick={() => {
                        setAttachments((a) => a.filter((item) => item.id !== att.id));
                        toast(`Removed ${att.name}`);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="ee-table-pagination">
          <span>{attachments.length === 0 ? "0–0" : `1–${attachments.length}`}</span>
          <button type="button" className="ee-page-btn" disabled>
            &lt;
          </button>
          <div className="ee-page-number-box">1</div>
          <button type="button" className="ee-page-btn" disabled>
            &gt;
          </button>
        </div>
      </div>
    </div>
  );
}
