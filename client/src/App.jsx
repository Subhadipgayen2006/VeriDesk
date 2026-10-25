import React, { useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, BadgeCheck, Check,
  ChevronDown, CircleHelp, ClipboardCheck, FileCheck2, FileSearch, FileText,
  FileUp, Fingerprint, Gauge, GraduationCap, Info, LoaderCircle, Menu,
  Plus, ScanText, Search, ShieldAlert, ShieldCheck, Sparkles, Trash2, X
} from "lucide-react";
import { createWorker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const API_BASE = "http://127.0.0.1:5000/api";
const DOC_TYPES = [
  { value: "application", label: "Application form" },
  { value: "institute", label: "Institution certificate" },
  { value: "lease", label: "Lease / land document" },
  { value: "infrastructure", label: "Infrastructure document" },
  { value: "other", label: "Other document" }
];

const demoDocs = [
  {
    id: "demo-1", name: "application_form_demo.txt", type: "application",
    text: "Institution Name: Sunrise Institute of Technology\nApplication ID: APP-2026-1042\nAcademic Year: 2026-2027\nSubmission Date: 2026-09-15\nAuthorized Signatory: Ananya Sen\nDocument Status: Submitted",
    source: "Synthetic demo data", status: "done"
  },
  {
    id: "demo-2", name: "institution_certificate_demo.txt", type: "institute",
    text: "Institution Name: Sunrise Institute of Technology\nCertificate Number: CERT-7781\nIssue Date: 2025-06-01\nExpiry Date: 2027-06-01\nAuthorized Signatory: Ananya Sen",
    source: "Synthetic demo data", status: "done"
  },
  {
    id: "demo-3", name: "lease_document_demo.txt", type: "lease",
    text: "Institution Name: Sunrise Institute of Technology\nLease Document Number: LEASE-552\nIssue Date: 2024-04-01\nExpiry Date: 2026-03-31\nProperty Address: Demo Road, Example City\nAuthorized Signatory: Ananya Sen",
    source: "Synthetic demo data", status: "done"
  }
];

function normalize(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function findField(text, labels) {
  const source = String(text || "").replace(/[|]/g, "I").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const knownLabels = [
    "Institution Name", "Institute Name", "College Name", "Name of Institution",
    "Application ID", "Application Number", "Application No",
    "Certificate Number", "Certificate No", "Certificate #", "Certificate ID", "Registration Number",
    "Expiry Date", "Expiration Date", "Valid Until", "Validity Date",
    "Issue Date", "Issued On", "Academic Year", "Session",
    "Authorized Signatory", "Authorised Signatory", "Signatory",
    "Property Address", "Institute Address", "Address", "Planted by", "Gifted to", "Quantity"
  ];
  const stopLabels = [...new Set([...knownLabels, ...labels])].sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\b)${escaped}\\s*(?:[:：#\\-–]\\s*|\\s{1,})(.+?)(?=\\s+(?:${stopLabels})\\b|$)`, "i");
    const match = source.match(re);
    if (match && match[1].trim()) return match[1].trim().replace(/[|,;]+$/, "");
  }
  // Some certificates print the number before/after a generic certificate label.
  if (labels.some(x => /certificate/i.test(x))) {
    const m = source.match(/\b(?:certificate|cert\.)\s*(?:no\.?|number|#|id)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,})\b/i);
    if (m) return m[1];
  }
  return "";
}
function parseDate(value) {
  if (!value) return null;
  const s = value.trim();
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}
function extractFields(text) {
  return {
    institutionName: findField(text, ["Institution Name", "Institute Name", "College Name", "Name of Institution"]),
    applicationId: findField(text, ["Application ID", "Application Number", "Application No"]),
    certificateNumber: findField(text, ["Certificate Number", "Certificate No", "Certificate #", "Certificate ID", "Registration Number"]),
    expiryDate: findField(text, ["Expiry Date", "Expiration Date", "Valid Until", "Validity Date"]),
    issueDate: findField(text, ["Issue Date", "Issued On"]),
    academicYear: findField(text, ["Academic Year", "Session"]),
    signatory: findField(text, ["Authorized Signatory", "Authorised Signatory", "Signatory"]),
    address: findField(text, ["Property Address", "Address", "Institute Address"])
  };
}
function validateDocuments(docs) {
  const findings = [];
  const allFields = docs.map(doc => ({ doc, fields: extractFields(doc.text || "") }));
  for (const { doc, fields } of allFields) {
    const lower = (doc.text || "").toLowerCase();
    const textReadable = Boolean(doc.text?.trim());
    if (!textReadable) {
      findings.push({ severity: "error", docId: doc.id, docName: doc.name, title: "No readable text found after text extraction and OCR", detail: "The app could not read text from this file even after trying OCR for scanned PDFs. Try a sharper scan, rotate the page upright, or upload a clearer image. This is an extraction failure, not proof that the document is invalid." });
    }
    if (textReadable && ["application", "institute", "lease", "infrastructure"].includes(doc.type) && !fields.institutionName) findings.push({ severity: "warning", docId: doc.id, docName: doc.name, title: "Institution name not detected", detail: "No supported institution-name label was detected in the extracted text. The name may be present under a different label or OCR may have misread it; review the extracted text before treating this as a missing field." });
    // Never imply that a document is valid just because a few fields were found.
    const anyFieldDetected = Object.values(fields).some(value => Boolean(String(value || "").trim()));
    const knownDocumentType = ["application", "institute", "lease", "infrastructure"].includes(doc.type);
    if (textReadable && !knownDocumentType) {
      findings.push({
        severity: "warning", docId: doc.id, docName: doc.name,
        title: "Limited validation — document type needs review",
        detail: "This file is currently classified as Other document, so document-specific required-field checks were not applied. Select the closest document type if appropriate, or review the original manually. No issue signal does not mean this document is valid or authentic."
      });
    }
    if (textReadable && !anyFieldDetected) findings.push({ severity: "warning", docId: doc.id, docName: doc.name, title: "Manual review required — no supported fields detected", detail: "Text was extracted, but none of the prototype's supported fields could be identified. Review the extracted text below, choose the correct document type, and verify the original. This is not a finding that the document is invalid." });
    const date = parseDate(fields.expiryDate);
    if (fields.expiryDate && !date) findings.push({ severity: "warning", docId: doc.id, docName: doc.name, title: "Expiry date needs review", detail: `Could not reliably interpret the detected date: "${fields.expiryDate}".` });
    else if (date && date < new Date(new Date().toDateString())) findings.push({ severity: "error", docId: doc.id, docName: doc.name, title: "Expiry date may have passed", detail: `Detected expiry date: ${fields.expiryDate}. Confirm date format and applicable rules.` });
    if (doc.type === "application" && !fields.applicationId) findings.push({ severity: "warning", docId: doc.id, docName: doc.name, title: "Application ID not detected", detail: "The demo validator expects a labelled Application ID / Application Number." });
    if (doc.type === "institute" && !fields.certificateNumber) findings.push({ severity: "warning", docId: doc.id, docName: doc.name, title: "Certificate number not detected", detail: "No clearly labelled certificate/registration number was found." });
    if (doc.type === "lease" && !fields.expiryDate) findings.push({ severity: "warning", docId: doc.id, docName: doc.name, title: "Lease expiry date not detected", detail: "A lease document commonly needs a validity check; verify the original and applicable requirements." });
    if (lower.includes("sample") || lower.includes("demo")) {
      // Intentionally no warning: sample/demo wording is not proof of a document issue.
    }
  }
  const names = allFields.filter(x => x.fields.institutionName).map(x => ({ ...x, norm: normalize(x.fields.institutionName) }));
  if (new Set(names.map(x => x.norm)).size > 1) {
    findings.push({
      severity: "warning", docId: "cross", docName: "Across uploaded documents",
      title: "Institution names differ across documents",
      detail: "At least two documents contain different institution-name text. This may be a formatting/abbreviation difference; verify manually."
    });
  }
  if (!findings.length) findings.push({ severity: "success", docId: "all", docName: "All uploaded documents", title: "No demo-rule issues detected", detail: "This is not proof of authenticity or official compliance. Human review is still required." });
  return { findings, fields: allFields };
}

function App() {
  const [docs, setDocs] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [results, setResults] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const [toast, setToast] = useState("");
  const fileInput = useRef(null);
  const findings = results?.findings || [];
  const errors = findings.filter(f => f.severity === "error").length;
  const warnings = findings.filter(f => f.severity === "warning").length;
  const filteredDocs = useMemo(() => docs.filter(d => `${d.name} ${d.type}`.toLowerCase().includes(search.toLowerCase())), [docs, search]);

  React.useEffect(() => {
    fetch(`${API_BASE}/health`).then(r => r.json()).then(() => setApiStatus("online")).catch(() => setApiStatus("offline"));
  }, []);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }
  function addFiles(fileList) {
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    const chosen = Array.from(fileList || []);
    const valid = chosen.filter(f => allowed.includes(f.type) || /\.(pdf|png|jpe?g)$/i.test(f.name));
    if (valid.length !== chosen.length) notify("Some files were skipped. Use PDF, PNG, or JPG files.");
    const additions = valid.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file, name: file.name, type: "other", text: "", source: "Uploaded file", status: "queued", size: file.size
    }));
    setDocs(prev => [...prev, ...additions]);
    setResults(null);
    if (additions.length) notify(`${additions.length} file(s) added`);
  }
  function updateDoc(id, patch) {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
    setResults(null);
  }
  function removeDoc(id) {
    setDocs(prev => prev.filter(d => d.id !== id));
    setResults(null);
  }
  async function runOcr(source, label) {
    const worker = await createWorker("eng", 1, { logger: m => {
      if (m.status === "recognizing text") setProgressText(`OCR ${label}: ${Math.round((m.progress || 0) * 100)}%`);
    }});
    try {
      const result = await worker.recognize(source);
      return result.data.text || "";
    } finally {
      await worker.terminate();
    }
  }
  async function extractPdf(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    const pageCount = Math.min(pdf.numPages, 20);
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(" "));
    }
    const embeddedText = pages.join("\n").trim();
    // Scanned/image-only PDFs often have no selectable text. Render pages and OCR them.
    if (embeddedText.replace(/\s/g, "").length >= 20) return embeddedText;
    const ocrPages = [];
    for (let i = 1; i <= pageCount; i++) {
      setProgressText(`Scanned PDF detected — OCR page ${i}/${pageCount}: ${file.name}`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      await page.render({ canvasContext: context, viewport }).promise;
      const pageText = await runOcr(canvas, `${file.name} page ${i}`);
      ocrPages.push(pageText);
      canvas.width = 0;
      canvas.height = 0;
    }
    const ocrText = ocrPages.join("\n").trim();
    return ocrText || embeddedText;
  }
  async function extractImage(file) {
    return runOcr(file, file.name);
  }
  async function runValidation() {
    if (!docs.length) {
      notify("Upload at least one document or load demo data first.");
      return;
    }
    setIsProcessing(true);
    setProgressText("Extracting document text…");
    try {
      const processed = [];
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        setProgressText(`Processing ${i + 1}/${docs.length}: ${doc.name}`);
        let text = doc.text || "";
        if (doc.file) {
          try {
            text = doc.file.type === "application/pdf" || /\.pdf$/i.test(doc.name)
              ? await extractPdf(doc.file)
              : await extractImage(doc.file);
          } catch (err) {
            text = "";
          }
        }
        const updated = { ...doc, text, status: text.trim() ? "done" : "review" };
        processed.push(updated);
        setDocs(prev => prev.map(d => d.id === doc.id ? updated : d));
      }
      const report = validateDocuments(processed);
      setResults({ ...report, createdAt: new Date().toISOString(), documentCount: processed.length });
      setActiveTab("results");
      setProgressText("");
      notify("Validation complete");
    } finally {
      setIsProcessing(false);
      setProgressText("");
    }
  }
  function loadDemo() {
    setDocs(demoDocs.map(d => ({ ...d })));
    setResults(null);
    setActiveTab("overview");
    notify("Synthetic demo documents loaded");
  }
  function downloadReport() {
    if (!results) return;
    const payload = {
      reportType: "Prototype document screening report",
      createdAt: results.createdAt,
      disclaimer: "Not official AICTE verification; no authenticity/forgery determination. Human review required.",
      documents: docs.map(d => {
        const extractedFields = extractFields(d.text || "");
        const supportedFieldCount = Object.values(extractedFields).filter(value => Boolean(String(value || "").trim())).length;
        const documentTypeKnown = ["application", "institute", "lease", "infrastructure"].includes(d.type);
        return {
          name: d.name,
          type: DOC_TYPES.find(t => t.value === d.type)?.label || d.type,
          extractionStatus: d.text?.trim() ? "text_extracted" : "no_text_extracted",
          reviewStatus: !d.text?.trim() || !documentTypeKnown || supportedFieldCount === 0 ? "needs_review" : "screening_checks_ran",
          supportedFieldCount,
          extractedTextPreview: (d.text || "").slice(0, 3000),
          extractedFields
        };
      }),
      findings: results.findings
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "validation-report.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const nav = [
    { id: "overview", label: "Overview", icon: Gauge },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "results", label: "Validation results", icon: ClipboardCheck }
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><ShieldCheck size={22}/></div><div><strong>VeriDesk</strong><span>Application Intelligence</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>{nav.map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={`nav-item ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)}><Icon size={18}/><span>{item.label}</span>{item.id === "results" && results && <span className="nav-count">{findings.length}</span>}</button>;
        })}</nav>
        <div className="sidebar-spacer"/>
        <div className="side-status"><div className={`status-dot ${apiStatus === "online" ? "green" : apiStatus === "offline" ? "amber" : ""}`}/><div><strong>Local API</strong><span>{apiStatus === "online" ? "Connected" : apiStatus === "offline" ? "Unavailable — UI still works" : "Checking connection…"}</span></div></div>
        <div className="side-foot">Prototype v1.0 <span>•</span> Demo environment</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{nav.find(n => n.id === activeTab)?.label}</strong></div>
          <div className="top-actions"><span className="secure-label"><ShieldCheck size={15}/> Local processing</span><div className="avatar">VD</div></div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><div className="eyebrow"><Sparkles size={14}/> DOCUMENT SCREENING WORKSPACE</div><h1>{activeTab === "overview" ? "Application validation" : activeTab === "documents" ? "Document workspace" : "Validation report"}</h1><p>Review application documents, detect missing information, and surface items for human review.</p></div>
            <button className="btn btn-secondary" onClick={loadDemo}><Sparkles size={16}/> Load demo data</button>
          </div>

          <div className="notice"><Info size={17}/><div><strong>Prototype disclaimer</strong><span>Flags are preliminary screening signals, not proof of fraud or official AICTE approval. Confirm every finding against original documents.</span></div></div>

          {activeTab === "overview" && <>
            <section className="stats-grid">
              <Stat icon={FileText} label="Documents added" value={docs.length} note="Current session" tone="blue"/>
              <Stat icon={BadgeCheck} label="Readable documents" value={docs.filter(d => d.text?.trim()).length} note="Text available" tone="green"/>
              <Stat icon={AlertTriangle} label="Warnings" value={warnings} note="Needs attention" tone="amber"/>
              <Stat icon={ShieldAlert} label="Critical flags" value={errors} note="Verify immediately" tone="red"/>
            </section>
            <section className="content-grid">
              <div className="panel upload-panel">
                <PanelTitle icon={FileUp} title="Add application documents" subtitle="Upload PDF or image files to begin screening"/>
                <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
                  <div className="upload-icon"><FileUp size={26}/></div><h3>Drop documents here</h3><p>or select files from your computer</p>
                  <button className="btn btn-primary" onClick={() => fileInput.current?.click()}><Plus size={17}/> Browse files</button>
                  <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ""; }}/>
                  <span className="file-types">PDF, PNG, JPG · Multiple files supported</span>
                </div>
                <div className="panel-footer"><span><ShieldCheck size={15}/> Files processed in your browser</span><span>Max 20 PDF pages per file</span></div>
              </div>
              <div className="panel process-panel">
                <PanelTitle icon={Activity} title="Screening pipeline" subtitle="How the prototype checks documents"/>
                <div className="pipeline">
                  <PipelineStep number="01" title="Extract text" desc="OCR for images, text extraction for PDFs" icon={ScanText} state="ready"/>
                  <PipelineStep number="02" title="Check required fields" desc="Look for labelled IDs, institution names and dates" icon={Search} state="ready"/>
                  <PipelineStep number="03" title="Compare documents" desc="Flag differing institution names across files" icon={Fingerprint} state="ready"/>
                  <PipelineStep number="04" title="Human review report" desc="Group findings by severity and evidence" icon={ClipboardCheck} state="ready"/>
                </div>
              </div>
            </section>
            <DocumentTable docs={docs} updateDoc={updateDoc} removeDoc={removeDoc} compact/>
            <div className="run-bar"><div><strong>{docs.length ? `${docs.length} document(s) ready` : "Ready to start"}</strong><span>{docs.length ? "Choose a type if needed, then run validation." : "Upload files or load synthetic demo data."}</span></div><button className="btn btn-primary btn-large" disabled={!docs.length || isProcessing} onClick={runValidation}>{isProcessing ? <LoaderCircle className="spin" size={18}/> : <Sparkles size={18}/>} {isProcessing ? "Processing…" : "Run validation"} <ArrowUpRight size={16}/></button></div>
            {isProcessing && <div className="progress-line"><LoaderCircle className="spin" size={16}/>{progressText}</div>}
          </>}

          {activeTab === "documents" && <>
            <div className="panel">
              <div className="panel-toolbar"><PanelTitle icon={FileText} title="Uploaded documents" subtitle="Set the document type to enable relevant demo checks"/><button className="btn btn-primary" onClick={() => fileInput.current?.click()}><Plus size={16}/> Add files</button><input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ""; }}/></div>
              <DocumentTable docs={filteredDocs} updateDoc={updateDoc} removeDoc={removeDoc}/>
              {!docs.length && <EmptyState title="No documents yet" text="Upload files or load demo data to get started." action={loadDemo}/>}
            </div>
            <div className="run-bar"><div><strong>{docs.length} document(s)</strong><span>Documents are kept in this browser session.</span></div><button className="btn btn-primary btn-large" disabled={!docs.length || isProcessing} onClick={runValidation}><Sparkles size={18}/> Run validation <ArrowUpRight size={16}/></button></div>
            {isProcessing && <div className="progress-line"><LoaderCircle className="spin" size={16}/>{progressText}</div>}
          </>}

          {activeTab === "results" && <>
            {!results ? <EmptyState title="No validation report yet" text="Upload documents, then run validation to generate a report." action={() => setActiveTab("overview")}/> : <>
              <div className="report-banner"><div className="report-icon"><ClipboardCheck size={24}/></div><div className="report-copy"><h2>Screening complete</h2><p>Generated {new Date(results.createdAt).toLocaleString()} · {results.documentCount} document(s) reviewed</p></div><button className="btn btn-secondary" onClick={downloadReport}><ArrowDownToLine size={16}/> Export JSON</button></div>
              <section className="stats-grid">
                <Stat icon={FileText} label="Documents reviewed" value={results.documentCount} note="Current report" tone="blue"/>
                <Stat icon={AlertTriangle} label="Warnings" value={warnings} note="Manual review advised" tone="amber"/>
                <Stat icon={ShieldAlert} label="Critical flags" value={errors} note="Check original document" tone="red"/>
                <Stat icon={Check} label="No flagged issues" value={findings.filter(f => f.severity === "success").length} note="Not proof of validity" tone="green"/>
              </section>
              <div className="panel findings-panel"><PanelTitle icon={FileSearch} title="Findings and evidence" subtitle="Each flag includes a reason to help reviewers investigate"/>
                <div className="finding-list">{findings.map((f, i) => <Finding key={`${f.docId}-${i}`} finding={f}/>)}</div>
              </div>
              <div className="panel"><PanelTitle icon={Fingerprint} title="Extracted field summary" subtitle="Text is extracted automatically; review OCR output for errors"/>
                <div className="field-table-wrap"><table className="field-table"><thead><tr><th>Document</th><th>Institution name</th><th>Application ID</th><th>Certificate no.</th><th>Expiry date</th></tr></thead><tbody>{results.fields.map(({doc, fields}) => <tr key={doc.id}><td><FileText size={15}/>{doc.name}</td><td>{fields.institutionName || "—"}</td><td>{fields.applicationId || "—"}</td><td>{fields.certificateNumber || "—"}</td><td>{fields.expiryDate || "—"}</td></tr>)}</tbody></table></div>
                <div className="extracted-preview-list">{results.fields.map(({doc}) => <details className="extracted-preview" key={`text-${doc.id}`}><summary>View extracted text — {doc.name}</summary><pre>{doc.text?.trim() || "No text could be extracted. Try a clearer scan or image-based OCR."}</pre></details>)}</div>
              </div>
            </>}
          </>}
          <footer className="page-footer"><span>VeriDesk · Application Validation Prototype</span><span><CircleHelp size={14}/> Screening support only — official review required</span></footer>
        </div>
      </main>
      {toast && <div className="toast"><Check size={17}/>{toast}<button onClick={() => setToast("")}><X size={15}/></button></div>}
    </div>
  );
}

function Stat({ icon: Icon, label, value, note, tone }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>;
}
function PanelTitle({ icon: Icon, title, subtitle }) {
  return <div className="panel-title"><div className="panel-title-icon"><Icon size={18}/></div><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}
function PipelineStep({ number, title, desc, icon: Icon }) {
  return <div className="pipeline-step"><div className="pipeline-number">{number}</div><div className="pipeline-icon"><Icon size={18}/></div><div className="pipeline-text"><strong>{title}</strong><span>{desc}</span></div><Check className="pipeline-check" size={16}/></div>;
}
function DocumentTable({ docs, updateDoc, removeDoc, compact = false }) {
  const [search, setSearch] = useState("");
  const visible = compact ? docs : docs.filter(d => `${d.name} ${d.type}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="panel document-panel"><div className="document-toolbar"><PanelTitle icon={FileText} title={compact ? "Recent documents" : "Document register"} subtitle={`${docs.length} document(s) in current session`}/>{!compact && <div className="search-box"><Search size={15}/><input placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)}/></div>}</div>
    {visible.length ? <div className="doc-list">{visible.map(doc => <div className="doc-row" key={doc.id}><div className="doc-type-icon"><FileText size={19}/></div><div className="doc-info"><strong title={doc.name}>{doc.name}</strong><span>{doc.source || "Uploaded file"}{doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ""}</span></div><select aria-label={`Document type for ${doc.name}`} value={doc.type} onChange={e => updateDoc(doc.id, { type: e.target.value })}>{DOC_TYPES.map(t => <option value={t.value} key={t.value}>{t.label}</option>)}</select><span className={`doc-status ${doc.status === "done" ? "complete" : doc.status === "review" ? "review" : "queued"}`}><span/>{doc.status === "done" ? "Text ready" : doc.status === "review" ? "Review text" : "Not processed"}</span><button className="icon-button danger-hover" title="Remove document" onClick={() => removeDoc(doc.id)}><Trash2 size={16}/></button></div>)}</div> : <div className="empty-inline"><FileText size={20}/>No matching documents.</div>}
    {compact && docs.length > 0 && <div className="compact-footer"><span>Showing {docs.length} document(s)</span><span>Change type using the dropdown <ChevronDown size={13}/></span></div>}
  </div>;
}
function Finding({ finding }) {
  const [expanded, setExpanded] = useState(true);
  const styles = { error: { cls: "critical", label: "Critical flag", icon: ShieldAlert }, warning: { cls: "warning", label: "Review", icon: AlertTriangle }, success: { cls: "success", label: "No issue signal", icon: BadgeCheck } };
  const s = styles[finding.severity] || styles.warning;
  const Icon = s.icon;
  return <div className={`finding ${s.cls}`}><div className="finding-icon"><Icon size={18}/></div><div className="finding-main"><div className="finding-head"><strong>{finding.title}</strong><span className={`severity-pill ${s.cls}`}>{s.label}</span></div><p>{finding.docName}</p>{expanded && <div className="finding-detail">{finding.detail}</div>}</div><button className="icon-button" aria-label={expanded ? "Hide finding details" : "Show finding details"} title={expanded ? "Hide details" : "Show details"} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={18}/> : <ArrowUpRight size={18}/>}</button></div>;
}
function EmptyState({ title, text, action }) {
  return <div className="empty-state"><div className="empty-icon"><FileSearch size={28}/></div><h2>{title}</h2><p>{text}</p>{action && <button className="btn btn-primary" onClick={action}><Sparkles size={16}/> Get started</button>}</div>;
}

export default App;
