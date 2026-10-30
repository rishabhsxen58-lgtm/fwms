import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Activity, ArrowDownToLine, ArrowRight, BarChart3, BookOpen, Check, ChevronDown, CircleAlert,
  ClipboardCheck, FileSpreadsheet, GraduationCap, LayoutDashboard, Menu, Plus, RefreshCw,
  Settings, ShieldCheck, Users, X
} from "lucide-react";

const WorkloadChart = lazy(() => import("./WorkloadChart.jsx"));

async function api(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers };
  const response = await fetch(path.startsWith("/api") ? path : `/api${path}`, {
    ...options, headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload.error ?? message;
      if (Array.isArray(payload.details) && payload.details.length) {
        const detailText = payload.details.map((item) => typeof item === "string" ? item : item.message ?? JSON.stringify(item)).join("; ");
        message = `${message}: ${detailText}`;
      }
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response;
}

const navItems = [
  { label: "Overview", path: "/app", icon: LayoutDashboard, roles: ["ADMIN", "HOD", "FACULTY"] },
  { label: "Faculty", path: "/app/faculty", icon: Users, roles: ["ADMIN", "HOD"] },
  { label: "Courses & sections", path: "/app/courses", icon: BookOpen, roles: ["ADMIN", "HOD"] },
  { label: "Allocations", path: "/app/allocations", icon: GraduationCap, roles: ["ADMIN", "HOD", "FACULTY"] },
  { label: "Workload analysis", path: "/app/workload", icon: BarChart3, roles: ["ADMIN", "HOD", "FACULTY"] },
  { label: "Approvals", path: "/app/approvals", icon: ClipboardCheck, roles: ["ADMIN", "HOD"] },
  { label: "Data import", path: "/app/import", icon: FileSpreadsheet, roles: ["ADMIN", "HOD"] },
  { label: "Settings & audit", path: "/app/settings", icon: Settings, roles: ["ADMIN", "HOD"] }
];

export default function App() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api("/demo/session")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]');
    if (meta) meta.setAttribute("content", "noindex,nofollow");
  }, [location.pathname]);

  if (checking) return <ScreenLoading />;
  if (!user) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-slate-600">Demo workspace is unavailable. Please contact the presenter.</div>;

  return <Routes>
    <Route path="/app/*" element={<Workspace user={user} />} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>;
}

function Brand() {
  return <Link to="/app" className="flex items-center gap-2 font-bold text-slate-900 no-underline"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-white"><GraduationCap size={21} /></span><span>Faculty<span className="text-blue-700">Workload</span></span></Link>;
}

function Workspace({ user }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  const notify = useCallback((message) => { setToast(message); window.setTimeout(() => setToast(""), 3800); }, []);
  const currentLabel = navItems.find((item) => item.path === location.pathname)?.label ?? "Overview";
  return <div className="app-layout">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <div className="mb-9 flex items-center justify-between px-2"><Brand /><button className="mobile-menu btn btn-secondary !min-h-8 !px-2" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={16} /></button></div>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Workspace</p>
      <nav className="space-y-1">{navItems.filter((item) => item.roles.includes(user.role)).map((item) =>
        <NavLink key={item.path} to={item.path} end={item.path === "/app"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><item.icon size={17} />{item.label}</NavLink>)}</nav>
      <div className="mt-auto rounded-lg bg-blue-50 p-3"><p className="text-sm font-semibold text-slate-800">Presentation Demo</p><p className="mt-1 text-xs text-slate-500">Public access · Sample data</p></div>
    </aside>
    {menuOpen && <button className="fixed inset-0 z-20 hidden bg-slate-900/20 max-[900px]:block" aria-label="Close navigation backdrop" onClick={() => setMenuOpen(false)} />}
    <div className="main-area">
      <header className="topbar"><div className="flex items-center gap-3"><button className="mobile-menu btn btn-secondary !min-h-9 !px-2" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /></button><div><h1 className="text-sm font-semibold text-slate-800">{currentLabel}</h1><p className="hidden text-xs text-slate-400 sm:block">Institution workload workspace</p></div></div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">PUBLIC DEMO</span></div></header>
      <main className="content"><Routes>
        <Route index element={<Dashboard user={user} />} />
        <Route path="faculty" element={<FacultyPage user={user} notify={notify} />} />
        <Route path="courses" element={<CoursesPage user={user} notify={notify} />} />
        <Route path="allocations" element={<AllocationsPage user={user} notify={notify} />} />
        <Route path="workload" element={<WorkloadPage user={user} notify={notify} />} />
        <Route path="approvals" element={<ApprovalsPage notify={notify} />} />
        <Route path="import" element={<ImportPage notify={notify} />} />
        <Route path="settings" element={<SettingsPage user={user} notify={notify} />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes></main>
    </div>
    {toast && <div role="status" className="toast">{toast}</div>}
  </div>;
}

function ScreenLoading() { return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={16} />Loading your workspace…</div>; }
function ErrorBanner({ message }) { return <div role="alert" className="flex gap-2 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700"><CircleAlert size={16} className="mt-0.5 shrink-0" />{message}</div>; }
function EmptyState({ title, copy, action }) { return <div className="py-12 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"><BookOpen size={18} /></div><h3 className="mt-3 text-sm font-semibold text-slate-800">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{copy}</p>{action && <div className="mt-4">{action}</div>}</div>; }
function Field({ label, value, onChange, type = "text", required = false, hint = "", min, max, step }) {
  return <label className="form-item block"><span className="label">{label}{required ? " *" : ""}</span><input className="field" type={type} required={required} value={value ?? ""} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} />{hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}</label>;
}
function SelectField({ label, value, onChange, options, required = false }) {
  return <label className="form-item block"><span className="label">{label}{required ? " *" : ""}</span><select className="field" required={required} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
function Modal({ title, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-900/35 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className={`my-auto w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-xl bg-white p-6 shadow-xl`}>
      <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><button className="btn btn-secondary !min-h-8 !px-2" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></div>{children}
    </section>
  </div>;
}
function PageHeader({ title, subtitle, action }) { return <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{action}</div>; }
function StatusBadge({ status }) {
  const color = status === "Balanced" || status === "approved" ? "badge-green" : status === "Underloaded" || status === "pending" ? "badge-amber" : status === "High Workload" || status === "rejected" ? "badge-red" : "badge-blue";
  return <span className={`badge ${color}`}>{status}</span>;
}
function useResource(path, refreshKey = 0) {
  const [data, setData] = useState(null); const [error, setError] = useState("");
  useEffect(() => { let alive = true; setError(""); api(path).then((value) => alive && setData(value)).catch((issue) => alive && setError(issue.message)); return () => { alive = false; }; }, [path, refreshKey]);
  return { data, error, setData };
}
function Dashboard({ user }) {
  const { data, error } = useResource("/dashboard");
  const { data: mlStatus } = useResource("/ml/status");
  const isFaculty = user.role === "FACULTY";
  return <><PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : "day"}, ${user.name.split(" ")[0]}`} subtitle="Here is the current workload picture for your workspace." />
    {error && <ErrorBanner message={error} />}
    {!data ? <LoadingCard /> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={isFaculty ? "Your weekly hours" : "Faculty members"} value={isFaculty ? `${data.workloads[0]?.hours ?? 0} h` : data.workloadStats.faculty} note={isFaculty ? data.workloads[0]?.status : "In your authorized scope"} icon={Users} />
        <Metric label="Balanced workload" value={data.workloadStats.balanced} note="Faculty within policy" icon={Check} />
        <Metric label="High workload" value={data.workloadStats.highWorkload} note="Above the balanced workload range" icon={CircleAlert} />
        <Metric label="Sections assigned" value={`${data.allocations.assigned} / ${data.allocations.totalSections}`} note={data.pendingApprovals ? `${data.pendingApprovals} recommendations awaiting review` : "Official allocations"} icon={BookOpen} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <section className="card"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold text-slate-900">Weekly workload distribution</h3><p className="mt-1 text-xs text-slate-500">Teaching and policy-counted additional duties</p></div><Link to="/app/workload" className="text-xs font-semibold text-blue-700">View analysis</Link></div>
          {data.workloads.length ? <Suspense fallback={<div className="flex h-64 items-center justify-center text-sm text-slate-500">Loading chart…</div>}><WorkloadChart data={data.workloads} /></Suspense> : <EmptyState title="No workload records yet" copy="Add faculty, teaching assignments and duties to see the workload chart." />}</section>
        <section className="card"><h3 className="font-semibold text-slate-900">Workload at a glance</h3><p className="mt-1 text-xs text-slate-500">Policy status from official allocation records</p><div className="mt-5 space-y-4">{[
          ["Balanced", data.workloadStats.balanced, "bg-emerald-500"], ["Underloaded", data.workloadStats.underloaded, "bg-amber-500"], ["High Workload", data.workloadStats.highWorkload, "bg-rose-500"]
        ].map(([label, count, color]) => <div key={label} className="flex items-center justify-between text-sm"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</div><span className="font-semibold text-slate-800">{count}</span></div>)}</div>
          <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-slate-600"><strong className="text-slate-800">Planning note</strong><br />Allocation suggestions are heuristic and require an authorized reviewer before they become official.</div>
          <p className="mt-4 text-xs text-slate-500">ML classifier: {mlStatus?.status ?? "Checking service availability…"} Workload calculations remain authoritative.</p>
        </section>
      </div>
      <section className="card mt-5"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-slate-900">{isFaculty ? "Your workload" : "Faculty workload status"}</h3><Link to="/app/workload" className="text-xs font-semibold text-blue-700">Full report</Link></div>
        <div className="table-wrap"><table><thead><tr><th>Faculty</th><th>Teaching</th><th>Additional duties</th><th>Total hours</th><th>Status</th></tr></thead><tbody>
          {data.workloads.map((row) => <tr key={row.id}><td className="font-medium text-slate-800">{row.name}</td><td>{row.teachingHours} h</td><td>{row.dutyHours} h</td><td className="font-semibold">{row.hours} h</td><td><StatusBadge status={row.status} /></td></tr>)}
        </tbody></table></div>
      </section>
    </>}
  </>;
}
function Metric({ label, value, note, icon: Icon }) {
  return <section className="card"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon size={18} /></span></div><p className="mt-3 text-xs text-slate-500">{note}</p></section>;
}
function LoadingCard() { return <div className="card flex items-center gap-2 text-sm text-slate-500"><RefreshCw size={15} className="animate-spin" />Loading live workspace data…</div>; }

function FacultyPage({ user, notify }) {
  const [refresh, setRefresh] = useState(0); const { data: faculty, error } = useResource("/faculty", refresh);
  const { data: departments } = useResource("/departments");
  const { data: duties } = useResource("/duties", refresh);
  const [editing, setEditing] = useState(null); const [query, setQuery] = useState("");
  const [dutyOpen, setDutyOpen] = useState(false); const [dutyEditId, setDutyEditId] = useState(null);
  const [duty, setDuty] = useState({ facultyId: "", title: "", hoursPerWeek: 1, counted: true });
  const blank = { name: "", email: "", password: "", departmentId: departments?.[0]?.id ?? "", designation: "Lecturer", minHours: 8, maxHours: 16, expertise: "" };
  const [form, setForm] = useState(blank); const [saving, setSaving] = useState(false); const [formError, setFormError] = useState("");
  const visible = (faculty ?? []).filter((person) => `${person.name} ${person.email} ${person.expertise.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  function open(person = null) {
    setEditing(person ?? "new");
    setForm(person ? { ...person, password: "", expertise: person.expertise.join(", "), minHours: person.minHours ?? 8, maxHours: person.maxHours ?? 16 } : { ...blank, departmentId: departments?.[0]?.id ?? "" });
    setFormError("");
  }
  async function save(event) {
    event.preventDefault(); setSaving(true); setFormError("");
    const body = { ...form, departmentId: Number(form.departmentId), minHours: Number(form.minHours), maxHours: Number(form.maxHours), expertise: form.expertise.split(",").map((s) => s.trim()).filter(Boolean) };
    if (!editing && !body.password) { setFormError("A temporary password is required."); setSaving(false); return; }
    try {
      if (editing !== "new") { delete body.email; delete body.password; await api(`/faculty/${editing.id}`, { method: "PATCH", body }); }
      else await api("/faculty", { method: "POST", body });
      notify(editing ? "Faculty profile updated." : "Faculty member created."); setEditing(null); setRefresh((v) => v + 1);
    } catch (issue) { setFormError(issue.message); } finally { setSaving(false); }
  }
  async function remove(person) {
    if (!window.confirm(`Delete faculty profile for ${person.name}? Related duties and expertise will also be removed.`)) return;
    try { await api(`/faculty/${person.id}`, { method: "DELETE" }); notify("Faculty member deleted."); setRefresh((v) => v + 1); }
    catch (issue) { notify(issue.message); }
  }
  async function saveDuty(event) {
    event.preventDefault();
    try {
      const body = { ...duty, facultyId: Number(duty.facultyId), hoursPerWeek: Number(duty.hoursPerWeek) };
      if (dutyEditId) await api(`/duties/${dutyEditId}`, { method: "PATCH", body: { title: body.title, hoursPerWeek: body.hoursPerWeek, counted: body.counted } });
      else await api("/duties", { method: "POST", body });
      setDutyOpen(false); setDutyEditId(null); setDuty({ facultyId: "", title: "", hoursPerWeek: 1, counted: true }); setRefresh((v) => v + 1); notify(dutyEditId ? "Additional duty updated." : "Additional duty created.");
    }
    catch (issue) { notify(issue.message); }
  }
  async function removeDuty(item) {
    if (!window.confirm(`Delete "${item.title}" duty?`)) return;
    try { await api(`/duties/${item.id}`, { method: "DELETE" }); setRefresh((v) => v + 1); notify("Duty deleted."); } catch (issue) { notify(issue.message); }
  }
  return <>
    <PageHeader title="Faculty" subtitle="Manage faculty profiles, expertise and individual workload limits." action={<button className="btn btn-primary" onClick={() => open()}><Plus size={16} /> Add faculty</button>} />
    {error && <ErrorBanner message={error} />}
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><input className="field max-w-xs" aria-label="Search faculty" placeholder="Search name or expertise…" value={query} onChange={(e) => setQuery(e.target.value)} /><span className="text-xs text-slate-500">{visible.length} faculty members</span></div>
      {faculty && !visible.length ? <EmptyState title="No faculty found" copy={query ? "Try a different search term." : "Add a faculty member to start tracking workload."} /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>Expertise</th><th>Weekly limits</th><th>Actions</th></tr></thead><tbody>
        {visible.map((person) => <tr key={person.id}><td><div className="font-semibold text-slate-800">{person.name}</div><div className="mt-1 text-xs text-slate-500">{person.email}</div></td><td>{person.department}</td><td>{person.expertise.join(", ") || "—"}</td><td>{person.minHours}–{person.maxHours} h</td><td><div className="flex gap-2"><button className="btn btn-secondary !min-h-8 !py-1" onClick={() => open(person)}>Edit</button><button className="btn btn-danger !min-h-8 !py-1" onClick={() => remove(person)}>Delete</button></div></td></tr>)}
      </tbody></table></div>}
    </section>
    <section className="card mt-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Additional duties</h3><p className="mt-1 text-xs text-slate-500">Duty hours are included only when marked as counted by policy.</p></div><button className="btn btn-secondary" onClick={() => setDutyOpen(true)}><Plus size={15} /> Add duty</button></div>
      {(duties?.length ?? 0) === 0 ? <p className="py-4 text-sm text-slate-500">No additional duties recorded.</p> : <div className="table-wrap"><table><thead><tr><th>Faculty</th><th>Duty</th><th>Hours / week</th><th>Counted</th><th></th></tr></thead><tbody>{duties.map((item) => <tr key={item.id}><td>{item.facultyName}</td><td>{item.title}</td><td>{item.hoursPerWeek}</td><td>{item.counted ? "Yes" : "No"}</td><td><div className="flex gap-2"><button className="btn btn-secondary !min-h-8 !py-1" onClick={() => { setDutyEditId(item.id); setDuty({ facultyId: item.facultyId, title: item.title, hoursPerWeek: item.hoursPerWeek, counted: Boolean(item.counted) }); setDutyOpen(true); }}>Edit</button><button className="btn btn-danger !min-h-8 !py-1" onClick={() => removeDuty(item)}>Delete</button></div></td></tr>)}</tbody></table></div>}
    </section>
    {editing && editing !== "new" && <Modal title="Edit faculty member" onClose={() => setEditing(null)}><form onSubmit={save} className="space-y-4">
      <div className="form-grid"><Field label="Full name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <SelectField label="Department" required value={form.departmentId} onChange={(v) => setForm({ ...form, departmentId: v })} options={(departments ?? []).map((d) => [d.id, d.name])} />
        <Field label="Designation" value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} /><Field label="Expertise (comma-separated)" value={form.expertise} onChange={(v) => setForm({ ...form, expertise: v })} />
        <Field label="Minimum weekly hours" type="number" min="0" max="80" step="0.5" value={form.minHours} onChange={(v) => setForm({ ...form, minHours: v })} /><Field label="Maximum weekly hours" type="number" min="1" max="80" step="0.5" value={form.maxHours} onChange={(v) => setForm({ ...form, maxHours: v })} />
      </div>{formError && <ErrorBanner message={formError} />}<div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button disabled={saving} className="btn btn-primary">{saving ? "Saving…" : "Save changes"}</button></div>
    </form></Modal>}
    {editing === "new" && <FacultyCreateDialog state={{ form, setForm, formError, setFormError, save, saving, departments, onClose: () => { setEditing(null); setForm(blank); setFormError(""); } }} open />}
    {dutyOpen && <Modal title={dutyEditId ? "Edit additional duty" : "Add additional duty"} onClose={() => { setDutyOpen(false); setDutyEditId(null); }}><form className="space-y-4" onSubmit={saveDuty}><div className="form-grid">
      {!dutyEditId && <SelectField label="Faculty member" required value={duty.facultyId || faculty?.[0]?.id} onChange={(v) => setDuty({ ...duty, facultyId: v })} options={(faculty ?? []).map((p) => [p.id, p.name])} />}
      <Field label="Duty title" required value={duty.title} onChange={(v) => setDuty({ ...duty, title: v })} />
      <Field label="Hours per week" required type="number" min="0" max="80" step="0.5" value={duty.hoursPerWeek} onChange={(v) => setDuty({ ...duty, hoursPerWeek: v })} />
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={duty.counted} onChange={(e) => setDuty({ ...duty, counted: e.target.checked })} /> Count toward workload</label>
    </div><FormActions cancel={() => { setDutyOpen(false); setDutyEditId(null); }} submit={dutyEditId ? "Save duty" : "Add duty"} /></form></Modal>}
  </>;
}

function FacultyCreateDialog({ state, open }) { if (!open) return null; return <Modal title="Add faculty member" onClose={state.onClose}><form onSubmit={state.save} className="space-y-4">
  <div className="form-grid"><Field label="Full name" required value={state.form.name} onChange={(v) => state.setForm({ ...state.form, name: v })} />
    <Field label="Email address" type="email" required value={state.form.email} onChange={(v) => state.setForm({ ...state.form, email: v })} />
    <SelectField label="Department" required value={state.form.departmentId} onChange={(v) => state.setForm({ ...state.form, departmentId: v })} options={(state.departments ?? []).map((d) => [d.id, d.name])} />
    <Field label="Temporary password" type="password" required minLength={10} value={state.form.password} onChange={(v) => state.setForm({ ...state.form, password: v })} hint="At least 10 characters; share securely with the account holder." />
    <Field label="Designation" value={state.form.designation} onChange={(v) => state.setForm({ ...state.form, designation: v })} /><Field label="Expertise (comma-separated)" value={state.form.expertise} onChange={(v) => state.setForm({ ...state.form, expertise: v })} />
    <Field label="Minimum weekly hours" type="number" min="0" max="80" step="0.5" value={state.form.minHours} onChange={(v) => state.setForm({ ...state.form, minHours: v })} /><Field label="Maximum weekly hours" type="number" min="1" max="80" step="0.5" value={state.form.maxHours} onChange={(v) => state.setForm({ ...state.form, maxHours: v })} />
  </div>{state.formError && <ErrorBanner message={state.formError} />}<div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={state.onClose}>Cancel</button><button disabled={state.saving} className="btn btn-primary">{state.saving ? "Creating…" : "Create faculty"}</button></div>
</form></Modal>; }

function CoursesPage({ user, notify }) {
  const [refresh, setRefresh] = useState(0); const { data: courses } = useResource("/courses", refresh);
  const { data: sections } = useResource("/sections", refresh); const { data: departments } = useResource("/departments");
  const [modal, setModal] = useState(""); const [error, setError] = useState("");
  const [editingCourse, setEditingCourse] = useState(null); const [editingSection, setEditingSection] = useState(null);
  const [course, setCourse] = useState({ code: "", name: "", subject: "", departmentId: "" });
  const [section, setSection] = useState({ courseId: "", sectionName: "A", lectureHours: 3, tutorialHours: 0, labHours: 0, day: "", slot: "09:00", term: "Current" });
  async function addCourse(event) {
    event.preventDefault(); setError("");
    try {
      const body = { ...course, departmentId: Number(course.departmentId) };
      if (editingCourse) await api(`/courses/${editingCourse.id}`, { method: "PATCH", body });
      else await api("/courses", { method: "POST", body });
      setModal(""); setEditingCourse(null); setCourse({ code: "", name: "", subject: "", departmentId: "" }); setRefresh((v) => v + 1); notify(editingCourse ? "Course updated." : "Course created.");
    }
    catch (issue) { setError(issue.message); }
  }
  async function addSection(event) {
    event.preventDefault(); setError("");
    try {
      const body = { ...section, lectureHours: Number(section.lectureHours), tutorialHours: Number(section.tutorialHours), labHours: Number(section.labHours), day: section.day || null, slot: section.day ? section.slot : null };
      if (editingSection) await api(`/sections/${editingSection.id}`, { method: "PATCH", body });
      else await api("/sections", { method: "POST", body: { ...body, courseId: Number(section.courseId) } });
      setModal(""); setEditingSection(null); setRefresh((v) => v + 1); notify(editingSection ? "Section updated." : "Section created.");
    }
    catch (issue) { setError(issue.message); }
  }
  async function deleteCourse(item) {
    if (!window.confirm(`Delete ${item.code} and its sections and allocations? This cannot be undone.`)) return;
    try { await api(`/courses/${item.id}`, { method: "DELETE" }); notify("Course deleted."); setRefresh((v) => v + 1); }
    catch (issue) { notify(issue.message); }
  }
  function editCourse(item) { setEditingCourse(item); setCourse({ code: item.code, name: item.name, subject: item.subject, departmentId: item.departmentId }); setError(""); setModal("course"); }
  function editSection(item) {
    setEditingSection(item);
    setSection({ courseId: item.courseId, sectionName: item.sectionName, lectureHours: item.lectureHours, tutorialHours: item.tutorialHours, labHours: item.labHours, day: item.day ?? "", slot: item.slot ?? "09:00", term: item.term ?? "Current" });
    setError(""); setModal("section");
  }
  async function deleteSection(item) {
    if (!window.confirm(`Delete section ${item.sectionName} from ${item.courseCode}?`)) return;
    try { await api(`/sections/${item.id}`, { method: "DELETE" }); notify("Section deleted."); setRefresh((v) => v + 1); } catch (issue) { notify(issue.message); }
  }
  return <>
    <PageHeader title="Courses & sections" subtitle="Maintain course expertise labels, teaching hours and timetable slots." action={<div className="flex gap-2"><button className="btn btn-secondary" onClick={() => { setError(""); setModal("course"); }}><Plus size={15} /> Course</button><button className="btn btn-primary" onClick={() => { setError(""); setModal("section"); }}><Plus size={15} /> Section</button></div>} />
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Course catalog</h3><span className="text-xs text-slate-500">{courses?.length ?? 0} courses</span></div>
        {(courses?.length ?? 0) === 0 ? <EmptyState title="No courses yet" copy="Create courses before adding their sections." action={<button className="btn btn-primary" onClick={() => setModal("course")}>Add course</button>} /> :
          <div className="table-wrap"><table><thead><tr><th>Code</th><th>Course</th><th>Subject</th><th>Actions</th></tr></thead><tbody>{courses.map((item) => <tr key={item.id}><td className="font-semibold">{item.code}</td><td>{item.name}</td><td>{item.subject}</td><td><div className="flex gap-2"><button className="btn btn-secondary !min-h-8 !py-1" onClick={() => editCourse(item)}>Edit</button><button className="btn btn-danger !min-h-8 !py-1" onClick={() => deleteCourse(item)}>Delete</button></div></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Teaching sections</h3><span className="text-xs text-slate-500">{sections?.length ?? 0} sections</span></div>
        {(sections?.length ?? 0) === 0 ? <EmptyState title="No sections yet" copy="Sections include weekly lecture, tutorial and lab hours." action={<button className="btn btn-primary" onClick={() => setModal("section")}>Add section</button>} /> :
          <div className="table-wrap"><table><thead><tr><th>Section</th><th>Hours / wk</th><th>Time</th><th>Faculty</th><th>Actions</th></tr></thead><tbody>{sections.map((item) => <tr key={item.id}><td><span className="font-semibold">{item.courseCode}-{item.sectionName}</span><div className="mt-1 text-xs text-slate-500">{item.courseName}</div></td><td>{Number(item.lectureHours) + Number(item.tutorialHours) + Number(item.labHours)}</td><td>{item.day ? `${item.day} ${item.slot}` : "Not scheduled"}</td><td>{item.facultyName ?? "Unassigned"}</td><td><div className="flex gap-2"><button className="btn btn-secondary !min-h-8 !py-1" onClick={() => editSection(item)}>Edit</button><button className="btn btn-danger !min-h-8 !py-1" onClick={() => deleteSection(item)}>Delete</button></div></td></tr>)}</tbody></table></div>}
      </section>
    </div>
    {modal === "course" && <Modal title={editingCourse ? "Edit course" : "Create course"} onClose={() => { setModal(""); setEditingCourse(null); }}><form className="space-y-4" onSubmit={addCourse}><div className="form-grid">
      <Field label="Course code" required value={course.code} onChange={(v) => setCourse({ ...course, code: v })} /><Field label="Course name" required value={course.name} onChange={(v) => setCourse({ ...course, name: v })} />
      <Field label="Expertise subject" required value={course.subject} onChange={(v) => setCourse({ ...course, subject: v })} hint="Used for matching faculty expertise." />
      <SelectField label="Department" required value={course.departmentId || departments?.[0]?.id} onChange={(v) => setCourse({ ...course, departmentId: v })} options={(departments ?? []).map((d) => [d.id, d.name])} />
    </div>{error && <ErrorBanner message={error} />}<FormActions cancel={() => { setModal(""); setEditingCourse(null); }} submit={editingCourse ? "Save course" : "Create course"} /></form></Modal>}
    {modal === "section" && <Modal title={editingSection ? `Edit ${editingSection.courseCode}-${editingSection.sectionName}` : "Create teaching section"} onClose={() => { setModal(""); setEditingSection(null); }}><form className="space-y-4" onSubmit={addSection}><div className="form-grid">
      {!editingSection && <SelectField label="Course" required value={section.courseId || courses?.[0]?.id} onChange={(v) => setSection({ ...section, courseId: v })} options={(courses ?? []).map((c) => [c.id, `${c.code} · ${c.name}`])} />}
      {!editingSection && <Field label="Section name" required value={section.sectionName} onChange={(v) => setSection({ ...section, sectionName: v })} />}
      <Field label="Lecture hours / week" type="number" min="0" max="40" step="0.5" value={section.lectureHours} onChange={(v) => setSection({ ...section, lectureHours: v })} />
      <Field label="Tutorial hours / week" type="number" min="0" max="40" step="0.5" value={section.tutorialHours} onChange={(v) => setSection({ ...section, tutorialHours: v })} />
      <Field label="Lab hours / week" type="number" min="0" max="40" step="0.5" value={section.labHours} onChange={(v) => setSection({ ...section, labHours: v })} />
      <SelectField label="Day (optional)" value={section.day} onChange={(v) => setSection({ ...section, day: v })} options={[["", "Not scheduled"], ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d) => [d, d])]} />
      {section.day && <Field label="Time slot" value={section.slot} onChange={(v) => setSection({ ...section, slot: v })} />}
      <Field label="Term" value={section.term} onChange={(v) => setSection({ ...section, term: v })} />
    </div>{error && <ErrorBanner message={error} />}<FormActions cancel={() => { setModal(""); setEditingSection(null); }} submit={editingSection ? "Save section" : "Create section"} /></form></Modal>}
  </>;
}

function FormActions({ cancel, submit, busy = false }) { return <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button><button disabled={busy} className="btn btn-primary">{busy ? "Saving…" : submit}</button></div>; }

function AllocationsPage({ user, notify }) {
  const [refresh, setRefresh] = useState(0); const { data: allocations, error } = useResource("/allocations", refresh);
  const { data: sections } = useResource("/sections", refresh); const { data: faculty } = useResource("/faculty", refresh);
  const [form, setForm] = useState({ sectionId: "", facultyId: "" }); const [saving, setSaving] = useState(false);
  const unassigned = (sections ?? []).filter((s) => !s.facultyId);
  async function assign(event) {
    event.preventDefault(); setSaving(true);
    try { const result = await api("/allocations", { method: "POST", body: { sectionId: Number(form.sectionId), facultyId: Number(form.facultyId) } }); notify(`Draft #${result.recommendationId} created. Review it in Approvals; official allocations are unchanged.`); }
    catch (issue) { notify(issue.message); } finally { setSaving(false); }
  }
  async function unassign(item) {
    if (!window.confirm(`Create an unassignment proposal for ${item.courseCode}-${item.sectionName}? It will not change official data until approved.`)) return;
    try { const result = await api(`/allocations/${item.sectionId}`, { method: "DELETE" }); notify(`Draft #${result.recommendationId} created. Review it in Approvals.`); }
    catch (issue) { notify(issue.message); }
  }
  const facultyOnly = user.role === "FACULTY";
  const [myAvailability, setMyAvailability] = useState([]);
  useEffect(() => { if (!facultyOnly) return; api(`/faculty/${user.id}/availability`).then((result) => setMyAvailability(result.slots)).catch(() => {}); }, [facultyOnly, user.id]);
  return <>
    <PageHeader title="Allocations" subtitle={facultyOnly ? "Your official teaching assignments." : "Review official allocations. Proposed manual changes require approval."} />
    {error && <ErrorBanner message={error} />}
    {!facultyOnly && <section className="card mb-5"><h3 className="font-semibold">Propose an assignment</h3><p className="mt-1 text-xs text-slate-500">Manual assignments create a review draft. Official records change only after approval.</p>
      <form onSubmit={assign} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><SelectField label="Section" required value={form.sectionId || sections?.[0]?.id} onChange={(v) => setForm({ ...form, sectionId: v })} options={(sections ?? []).map((s) => [s.id, `${s.courseCode}-${s.sectionName} · ${s.subject}${s.facultyName ? ` · current: ${s.facultyName}` : " · unassigned"}`])} /></div>
        <div className="min-w-[220px] flex-1"><SelectField label="Faculty member" required value={form.facultyId || faculty?.[0]?.id} onChange={(v) => setForm({ ...form, facultyId: v })} options={(faculty ?? []).map((f) => [f.id, `${f.name} · ${f.expertise.join(", ") || "No expertise recorded"}`])} /></div>
        <button disabled={saving || !sections?.length} className="btn btn-primary">{saving ? "Creating…" : "Create assignment draft"}</button>
      </form>
      {!unassigned.length && sections?.length > 0 && <p className="mt-2 text-xs text-slate-500">All sections currently have an official assignment. You can still select a section to reassign it.</p>}
    </section>}
    <section className="card"><div className="mb-4 flex justify-between"><h3 className="font-semibold">Official allocations</h3><span className="text-xs text-slate-500">{allocations?.length ?? 0} records</span></div>
      {!allocations?.length ? <EmptyState title="No official allocations" copy="Once sections are allocated, the records will be listed here." /> : <div className="table-wrap"><table><thead><tr><th>Course</th><th>Section</th><th>Faculty</th><th>Teaching hours</th><th>Time</th>{!facultyOnly && <th />}</tr></thead><tbody>
        {allocations.map((item) => <tr key={item.id}><td><strong>{item.courseCode}</strong><div className="mt-1 text-xs text-slate-500">{item.subject}</div></td><td>{item.sectionName}</td><td>{item.facultyName}</td><td>{Number(item.lectureHours) + Number(item.tutorialHours) + Number(item.labHours)} h</td><td>{item.day ? `${item.day} ${item.slot}` : "—"}</td>{!facultyOnly && <td><button className="btn btn-danger !min-h-8 !py-1" onClick={() => unassign(item)}>Request unassignment</button></td>}</tr>)}
      </tbody></table></div>}
    </section>
    {facultyOnly && <AvailabilityPanel user={user} initial={myAvailability} notify={notify} />}
  </>;
}

function AvailabilityPanel({ user, initial, notify }) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const slots = ["09:00", "11:00", "13:00", "15:00"];
  const [blocked, setBlocked] = useState(new Set());
  useEffect(() => setBlocked(new Set(initial.filter((item) => !item.available).map((item) => `${item.day}:${item.slot}`))), [initial]);
  async function save() {
    try {
      await api(`/faculty/${user.id}/availability`, { method: "PUT", body: { slots: days.flatMap((day) => slots.map((slot) => ({ day, slot, available: !blocked.has(`${day}:${slot}`) }))) } });
      notify("Availability saved.");
    } catch (issue) { notify(issue.message); }
  }
  return <section className="card mt-5"><h3 className="font-semibold">Your availability</h3><p className="mt-1 text-xs text-slate-500">Select any unavailable periods. Unlisted periods are treated as available for planning.</p>
    <div className="table-wrap mt-4"><table><thead><tr><th>Day</th>{slots.map((slot) => <th key={slot}>{slot}</th>)}</tr></thead><tbody>{days.map((day) => <tr key={day}><td className="font-medium">{day}</td>{slots.map((slot) => <td key={slot}><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={!blocked.has(`${day}:${slot}`)} onChange={(e) => setBlocked((current) => { const updated = new Set(current); e.target.checked ? updated.delete(`${day}:${slot}`) : updated.add(`${day}:${slot}`); return updated; })} />Available</label></td>)}</tr>)}</tbody></table></div>
    <button onClick={save} className="btn btn-primary mt-4">Save availability</button>
  </section>;
}

function WorkloadPage({ user, notify }) {
  const isFaculty = user.role === "FACULTY";
  const [refresh, setRefresh] = useState(0); const { data: workloads, error } = useResource("/workloads", refresh);
  const [analysis, setAnalysis] = useState(null); const [busy, setBusy] = useState("");
  async function runAnalysis() {
    setBusy("analyze");
    try { setAnalysis(await api("/workflows/analyze", { method: "POST", body: {} })); }
    catch (issue) { notify(issue.message); } finally { setBusy(""); }
  }
  async function generate() {
    if (!window.confirm("Create a draft recommendation? Official allocations will not change until it is approved.")) return;
    setBusy("generate");
    try {
      const result = await api("/workflows/generate", { method: "POST", body: {} });
      notify(`Draft recommendation #${result.recommendationId} created.`);
      setAnalysis({ generated: result });
    } catch (issue) { notify(issue.message); } finally { setBusy(""); }
  }
  async function exportCsv() {
    try { const response = await api("/reports/workload.csv"); const blob = await response.blob(); downloadBlob(blob, "workload-report.csv"); }
    catch (issue) { notify(issue.message); }
  }
  return <>
    <PageHeader title="Workload analysis" subtitle="Official teaching and counted-duty hours evaluated against institutional policy."
      action={<div className="flex flex-wrap gap-2"><button onClick={exportCsv} className="btn btn-secondary"><ArrowDownToLine size={15} /> Export CSV</button>{!isFaculty && <><button disabled={!!busy} onClick={runAnalysis} className="btn btn-secondary">{busy === "analyze" ? "Analyzing…" : "Analyze existing"}</button><button disabled={!!busy} onClick={generate} className="btn btn-primary">{busy === "generate" ? "Generating…" : "Generate draft"}</button></>}</div>} />
    {error && <ErrorBanner message={error} />}
    <section className="card">
      {!workloads ? <LoadingCard /> : !workloads.length ? <EmptyState title="No workload data" copy="Add faculty, teaching sections and duties to calculate workload." /> :
        <div className="table-wrap"><table><thead><tr><th>Faculty</th><th>Teaching</th><th>Additional duties</th><th>Total weekly hours</th><th>Classification</th><th>Policy limits</th></tr></thead><tbody>
          {workloads.map((person) => <tr key={person.id}><td className="font-semibold">{person.name}</td><td>{person.teachingHours} h</td><td>{person.dutyHours} h</td><td className="font-bold">{person.hours} h</td><td><StatusBadge status={person.status} /></td><td>{person.policy.balanced_min}–{person.policy.balanced_max} h balanced; &gt;{person.policy.overload_threshold} h overload alert{person.overThreshold ? " · flagged" : ""}</td></tr>)}
        </tbody></table></div>}
    </section>
    {!isFaculty && analysis && !analysis.generated && <section className="card mt-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Existing allocation analysis</h3><p className="mt-1 text-xs text-slate-500">{analysis.message} · {analysis.unallocatedSections} unallocated sections</p></div><StatusBadge status={analysis.unallocatedSections ? "Review" : "Analyzed"} /></div>
      <div className="table-wrap"><table><thead><tr><th>Faculty</th><th>Total</th><th>Status</th><th>Recommendation</th></tr></thead><tbody>{analysis.workloads.map((item) => <tr key={item.facultyId}><td>{item.name}</td><td>{item.hours} h</td><td><StatusBadge status={item.status} /></td><td>{item.recommendations.join(" ")}</td></tr>)}</tbody></table></div>
    </section>}
    {!isFaculty && analysis?.generated && <section className="card mt-5"><div className="mb-4"><h3 className="font-semibold">Draft allocation recommendation #{analysis.generated.recommendationId}</h3><p className="mt-1 text-xs text-slate-500">{analysis.generated.notice}</p></div>
      {analysis.generated.unassigned.length > 0 && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{analysis.generated.unassigned.length} section(s) could not be assigned within recorded constraints. Review the reasons before approval.</div>}
      <div className="table-wrap"><table><thead><tr><th>Section</th><th>Previous</th><th>Suggested</th><th>Reason</th></tr></thead><tbody>{analysis.generated.proposals.map((item) => <tr key={item.sectionId}><td>{item.sectionName}</td><td>{item.previousFacultyName ?? "Unassigned"}</td><td>{item.facultyName ?? "Unassigned"}</td><td className="max-w-sm whitespace-normal">{item.reason}</td></tr>)}</tbody></table></div>
      <Link to="/app/approvals" className="btn btn-primary mt-4">Review recommendation <ArrowRight size={15} /></Link>
    </section>}
    <section className="mt-5 grid gap-4 md:grid-cols-3">
      <InfoCard title="Calculation" text="Teaching hours sum lecture, tutorial and lab hours from official section allocations." />
      <InfoCard title="Additional duties" text="A duty contributes only when it is marked counted and the institution policy enables counted duties." />
      <InfoCard title="Classification" text="Underloaded, Balanced and High Workload labels use the institution policy thresholds; ML does not alter these calculations." />
    </section>
  </>;
}
function InfoCard({ title, text }) { return <section className="card"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-5 text-slate-500">{text}</p></section>; }

function ApprovalsPage({ notify }) {
  const [refresh, setRefresh] = useState(0); const { data: recommendations, error } = useResource("/recommendations", refresh);
  const [selectedId, setSelectedId] = useState(null); const [detail, setDetail] = useState(null); const [faculty, setFaculty] = useState([]);
  useEffect(() => { api("/faculty").then(setFaculty).catch(() => setFaculty([])); }, []);
  useEffect(() => { if (!selectedId) { setDetail(null); return; } api(`/recommendations/${selectedId}`).then(setDetail).catch((issue) => notify(issue.message)); }, [selectedId, refresh]);
  async function review(decision) {
    if (decision === "approve" && !window.confirm("Approve this draft? Official allocations will be updated and an audit record created.")) return;
    try {
      const result = await api(`/recommendations/${selectedId}/review`, { method: "POST", body: { decision } });
      notify(decision === "approve" ? `Approved. ${result.allocationsChanged} allocation records updated.` : "Recommendation rejected.");
      setSelectedId(null); setRefresh((v) => v + 1);
    } catch (issue) { notify(issue.message); }
  }
  async function changeAssignee(item, value) {
    try { await api(`/recommendations/${selectedId}/items/${item.id}`, { method: "PATCH", body: { facultyId: value ? Number(value) : null } }); const updated = await api(`/recommendations/${selectedId}`); setDetail(updated); notify("Draft assignment updated."); }
    catch (issue) { notify(issue.message); }
  }
  return <>
    <PageHeader title="Approval queue" subtitle="Review recommendations. Official assignments change only after approval." />
    {error && <ErrorBanner message={error} />}
    <div className="grid gap-5 xl:grid-cols-[minmax(280px,.8fr)_minmax(0,1.5fr)]">
      <section className="card"><h3 className="mb-3 font-semibold">Recommendations</h3>
        {!recommendations?.length ? <EmptyState title="No recommendations yet" copy="Run Generate draft from Workload analysis to create a proposal." /> :
          <div className="space-y-2">{recommendations.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === item.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
            <div className="flex items-center justify-between"><span className="font-semibold text-slate-800">Draft #{item.id}</span><StatusBadge status={item.status} /></div><p className="mt-1 text-xs text-slate-500">{item.summary}</p><p className="mt-2 text-[11px] text-slate-400">Created by {item.createdBy} · {new Date(item.createdAt).toLocaleDateString()}</p>
          </button>)}</div>}
      </section>
      <section className="card">{!selectedId ? <EmptyState title="Select a recommendation" copy="Choose a draft to review proposed assignments and constraint notes." /> : !detail ? <LoadingCard /> :
        <><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Recommendation #{detail.id}</h3><p className="mt-1 text-xs text-slate-500">{detail.summary}</p></div><StatusBadge status={detail.status} /></div>
          {detail.status === "pending" && <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-slate-600">Review fit, hours and constraint notes. This heuristic does not guarantee an optimal result.</div>}
          <div className="table-wrap"><table><thead><tr><th>Section</th><th>Previous</th><th>Suggested faculty</th><th>Reason</th></tr></thead><tbody>{detail.items.map((item) => <tr key={item.id}>
            <td>{item.courseCode}-{item.sectionName} · {item.courseName}</td><td>{item.previousFacultyName ?? "Unassigned"}</td>
            <td>{detail.status === "pending" ? <select aria-label={`Suggested faculty for ${item.sectionName}`} className="field min-w-40 !py-1" value={item.facultyId ?? ""} onChange={(e) => changeAssignee(item, e.target.value)}><option value="">Unassigned</option>{faculty.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select> : item.facultyName ?? "Unassigned"}</td>
            <td className="min-w-52 whitespace-normal text-xs">{item.reason}</td>
          </tr>)}</tbody></table></div>
          {detail.status === "pending" && <div className="mt-5 flex justify-end gap-2"><button className="btn btn-danger" onClick={() => review("reject")}>Reject draft</button><button className="btn btn-primary" onClick={() => review("approve")}><Check size={15} /> Approve changes</button></div>}
        </>}
      </section>
    </div>
  </>;
}

function ImportPage({ notify }) {
  const [entity, setEntity] = useState("faculty"); const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]); const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [credentials, setCredentials] = useState([]);
  const fields = {
    faculty: ["name", "email", "department", "designation", "minHours", "maxHours", "expertise"],
    courses: ["code", "name", "subject", "department"],
    sections: ["courseCode", "sectionName", "lectureHours", "tutorialHours", "labHours", "day", "slot", "term"],
    duties: ["email", "title", "hoursPerWeek", "counted"]
  }[entity];
  async function chooseFile(event) {
    const selected = event.target.files?.[0] ?? null; setFile(selected); setPreview(null); setError("");
    if (!selected) return;
    if (!/\.(csv|xlsx)$/i.test(selected.name)) { setError("Choose a .csv or .xlsx file."); setFile(null); return; }
    try {
      const upload = new FormData(); upload.append("file", selected);
      const result = await api("/import/headers", { method: "POST", body: upload });
      setHeaders(result.headers); setMapping(Object.fromEntries(fields.map((field) => [field, result.headers.includes(field) ? field : ""])));
    } catch (issue) { setError(issue.message); }
  }
  async function getTemplate() {
    try { const response = await api(`/import/templates/${entity}`); downloadBlob(await response.blob(), `${entity}-template.csv`); }
    catch (issue) { setError(issue.message); }
  }
  async function runPreview(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = new FormData(); data.append("file", file); data.append("entity", entity); data.append("mapping", JSON.stringify(mapping));
      setPreview(await api("/import/preview", { method: "POST", body: data }));
    } catch (issue) { setError(issue.message); } finally { setBusy(false); }
  }
  async function confirmImport() {
    if (!preview || !window.confirm(`Import ${preview.validRows} ${entity} rows into this institution?`)) return;
    setBusy(true); setError("");
    try { const result = await api(`/import/${preview.batchId}/confirm`, { method: "POST", body: {} }); notify(`${result.imported} rows imported.`); setCredentials(result.initialCredentials ?? []); setFile(null); setPreview(null); }
    catch (issue) { setError(issue.message); } finally { setBusy(false); }
  }
  return <>
    <PageHeader title="Import data" subtitle="Upload a CSV, map source columns, validate and preview, then explicitly confirm the import." />
    <section className="card">
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField label="Data type" value={entity} onChange={(value) => { setEntity(value); setFile(null); setHeaders([]); setPreview(null); }} options={[["faculty", "Faculty"], ["courses", "Courses"], ["sections", "Teaching sections"], ["duties", "Additional duties"]]} />
        <div className="self-end"><button className="btn btn-secondary" onClick={getTemplate}><ArrowDownToLine size={15} /> Download {entity} template</button></div>
        <label className="block"><span className="label">Excel or CSV file (2 MB maximum)</span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="field !p-2" onChange={chooseFile} /></label>
      </div>
      {file && <form onSubmit={runPreview} className="mt-6 border-t border-slate-100 pt-5">
        <h3 className="font-semibold">Map columns</h3><p className="mt-1 text-xs text-slate-500">Choose which uploaded column supplies each field. Required fields are marked.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map((field) => {
          const required = ({ faculty: ["name", "email", "department"], courses: ["code", "name", "subject", "department"], sections: ["courseCode", "sectionName"], duties: ["email", "title", "hoursPerWeek"] })[entity].includes(field);
          return <SelectField key={field} label={`${field}${required ? " *" : ""}`} value={mapping[field] ?? ""} onChange={(value) => setMapping({ ...mapping, [field]: value })} options={[["", "Not mapped"], ...headers.map((header) => [header, header])]} />;
        })}</div>
        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
        <button disabled={busy} className="btn btn-primary mt-4">{busy ? "Validating…" : "Validate and preview"}</button>
      </form>}
    </section>
    {preview && <section className="card mt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Import preview</h3><p className="mt-1 text-sm text-slate-500">{preview.validRows} valid rows out of {preview.totalRows}. Confirm only after reviewing any errors.</p></div><button disabled={busy || preview.errors.length > 0} onClick={confirmImport} className="btn btn-primary"><Check size={15} /> Confirm import</button></div>
      {preview.errors.length ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-900">{preview.errors.length} validation issue(s)</p><ul className="mt-2 max-h-52 list-inside list-disc overflow-auto text-sm text-amber-900">{preview.errors.map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul></div> : <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><Check size={16} /> No row-level validation issues found.</p>}
      <p className="mt-3 text-xs text-slate-500">Department, course and faculty references are checked again during confirmation. A failed import is rolled back.</p>
    </section>}
    {credentials.length > 0 && <section className="card mt-5 border-amber-200"><h3 className="font-semibold text-amber-900">One-time faculty credentials</h3><p className="mt-1 text-xs leading-5 text-amber-800">These temporary passwords are shown only in this response. Share them with faculty through a secure channel and do not save or publish this screen.</p>
      <div className="table-wrap mt-3"><table><thead><tr><th>Email</th><th>Temporary password</th></tr></thead><tbody>{credentials.map((item) => <tr key={item.email}><td>{item.email}</td><td><code>{item.temporaryPassword}</code></td></tr>)}</tbody></table></div>
      <button className="btn btn-secondary mt-3" onClick={() => { setCredentials([]); notify("Temporary credentials cleared from this screen."); }}>Clear credentials</button>
    </section>}
  </>;
}

function SettingsPage({ user, notify }) {
  const [refresh, setRefresh] = useState(0); const { data: policy } = useResource("/policy", refresh);
  const { data: departments } = useResource("/departments", refresh); const { data: logs } = useResource("/audit", refresh);
  const { data: mlStatus } = useResource("/ml/status", refresh); const { data: mlMetrics, error: mlError } = useResource("/ml/metrics", refresh);
  const { data: heads } = useResource(user.role === "ADMIN" ? "/hods" : "/departments", refresh);
  const [values, setValues] = useState(null); const [deptName, setDeptName] = useState(""); const [error, setError] = useState("");
  const [training, setTraining] = useState(false); const [trainedMetrics, setTrainedMetrics] = useState(null);
  const [head, setHead] = useState({ name: "", email: "", password: "", departmentId: "" });
  useEffect(() => { if (policy) setValues({ balancedMin: policy.balanced_min, balancedMax: policy.balanced_max, overloadThreshold: policy.overload_threshold, dutyHoursCounted: Boolean(policy.duty_hours_counted) }); }, [policy]);
  async function savePolicy(event) {
    event.preventDefault(); setError("");
    try { await api("/policy", { method: "PUT", body: { ...values, balancedMin: Number(values.balancedMin), balancedMax: Number(values.balancedMax), overloadThreshold: Number(values.overloadThreshold) } }); setRefresh((n) => n + 1); notify("Workload policy saved."); }
    catch (issue) { setError(issue.message); }
  }
  async function addDepartment(event) {
    event.preventDefault(); setError("");
    try { await api("/departments", { method: "POST", body: { name: deptName } }); setDeptName(""); setRefresh((n) => n + 1); notify("Department created."); }
    catch (issue) { setError(issue.message); }
  }
  async function editDepartment(department) {
    const name = window.prompt("Department name", department.name);
    if (!name?.trim()) return;
    try { await api(`/departments/${department.id}`, { method: "PATCH", body: { name: name.trim() } }); setRefresh((n) => n + 1); notify("Department updated."); }
    catch (issue) { notify(issue.message); }
  }
  async function deleteDepartment(department) {
    if (!window.confirm(`Delete department "${department.name}"? It must not contain faculty or courses.`)) return;
    try { await api(`/departments/${department.id}`, { method: "DELETE" }); setRefresh((n) => n + 1); notify("Department deleted."); }
    catch (issue) { notify(issue.message); }
  }
  async function addHead(event) {
    event.preventDefault();
    try { await api("/hods", { method: "POST", body: { ...head, departmentId: Number(head.departmentId) } }); setHead({ name: "", email: "", password: "", departmentId: "" }); setRefresh((n) => n + 1); notify("Department head account created."); }
    catch (issue) { setError(issue.message); }
  }
  async function deleteHead(item) {
    if (!window.confirm(`Remove department head account for ${item.name}?`)) return;
    try { await api(`/hods/${item.id}`, { method: "DELETE" }); setRefresh((n) => n + 1); notify("Department head account removed."); }
    catch (issue) { notify(issue.message); }
  }
  async function trainModel() {
    setTraining(true);
    try { const result = await api("/ml/train", { method: "POST", body: {} }); setTrainedMetrics(result); setRefresh((n) => n + 1); notify("Random Forest trained and evaluated."); }
    catch (issue) { notify(issue.message); } finally { setTraining(false); }
  }
  const metrics = trainedMetrics ?? mlMetrics;
  return <>
    <PageHeader title="Settings & audit" subtitle="Configure the policy used to calculate and classify faculty workload." />
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <section className="card"><h3 className="font-semibold">Workload policy</h3><p className="mt-1 text-xs text-slate-500">Hours are weekly. Values apply to all workload reports and analyses in this institution.</p>
        {values && <form onSubmit={savePolicy} className="mt-5 space-y-4"><div className="form-grid">
          <Field label="Balanced workload minimum" type="number" min="0" max="80" step="0.5" value={values.balancedMin} onChange={(v) => setValues({ ...values, balancedMin: v })} />
          <Field label="Balanced workload maximum" type="number" min="1" max="80" step="0.5" value={values.balancedMax} onChange={(v) => setValues({ ...values, balancedMax: v })} />
          <Field label="Overload alert threshold" type="number" min="1" max="100" step="0.5" value={values.overloadThreshold} onChange={(v) => setValues({ ...values, overloadThreshold: v })} />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={values.dutyHoursCounted} onChange={(e) => setValues({ ...values, dutyHoursCounted: e.target.checked })} /> Count marked additional duties</label>
        </div>{error && <ErrorBanner message={error} />}<button className="btn btn-primary">Save policy</button></form>}
      </section>
      <section className="card"><h3 className="font-semibold">Departments</h3><p className="mt-1 text-xs text-slate-500">Departments are isolated within the institution workspace.</p>
        <form className="mt-4 flex gap-2" onSubmit={addDepartment}><input className="field" placeholder="New department name" required value={deptName} onChange={(e) => setDeptName(e.target.value)} /><button className="btn btn-primary"><Plus size={15} /> Add</button></form>
        <div className="mt-4 divide-y divide-slate-100">{(departments ?? []).map((dept) => <div key={dept.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{dept.name}</span><div className="flex items-center gap-2"><button className="text-xs font-semibold text-blue-700" onClick={() => editDepartment(dept)}>Edit</button><button className="text-xs font-semibold text-red-600" onClick={() => deleteDepartment(dept)}>Delete</button><span className="text-xs text-slate-400">#{dept.id}</span></div></div>)}</div>
      </section>
      {user.role === "ADMIN" && <section className="card xl:col-span-2"><h3 className="font-semibold">Department head accounts</h3><p className="mt-1 text-xs text-slate-500">HOD accounts are restricted to the department selected here.</p>
        <form className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={addHead}>
          <Field label="Full name" required value={head.name} onChange={(v) => setHead({ ...head, name: v })} />
          <Field label="Email" type="email" required value={head.email} onChange={(v) => setHead({ ...head, email: v })} />
          <Field label="Temporary password" type="password" required minLength={10} value={head.password} onChange={(v) => setHead({ ...head, password: v })} />
          <SelectField label="Department" required value={head.departmentId || departments?.[0]?.id} onChange={(v) => setHead({ ...head, departmentId: v })} options={(departments ?? []).map((d) => [d.id, d.name])} />
          <button className="btn btn-primary self-end">Create HOD account</button>
        </form>
        {heads?.length > 0 && <div className="table-wrap mt-4"><table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th></th></tr></thead><tbody>{heads.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td>{item.department}</td><td><button className="btn btn-danger !min-h-8 !py-1" onClick={() => deleteHead(item)}>Remove</button></td></tr>)}</tbody></table></div>}
      </section>}
    </div>
    <section className="card mt-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">Optional ML workload classifier</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">A Random Forest estimates a workload label from teaching and additional-duty hours. Training uses clearly labeled synthetic examples. The classifier does not replace policy calculations or allocation optimization.</p></div><button disabled={training} onClick={trainModel} className="btn btn-secondary"><RefreshCw size={15} className={training ? "animate-spin" : ""} /> {training ? "Training…" : "Train & evaluate"}</button></div>
      <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm"><span className="font-semibold">Service status: </span>{mlStatus?.status ?? mlError ?? "Checking service availability…"}</div>
      {metrics && <div className="mt-4"><p className="text-sm font-semibold">Held-out evaluation · {metrics.trainingData} training data · {metrics.trainingRows} train rows / {metrics.testRows} test rows</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><Metric label="Accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} note="Measured on held-out test data" icon={Activity} /><Metric label="Macro F1" value={metrics.macroF1.toFixed(3)} note="Measured across all workload classes" icon={BarChart3} /></div>
        <div className="table-wrap mt-4"><table><thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1 score</th><th>Test support</th></tr></thead><tbody>{metrics.labels.map((label) => <tr key={label}><td>{label}</td><td>{metrics.classificationReport[label].precision.toFixed(3)}</td><td>{metrics.classificationReport[label].recall.toFixed(3)}</td><td>{metrics.classificationReport[label].f1Score.toFixed(3)}</td><td>{metrics.classificationReport[label].support}</td></tr>)}</tbody></table></div>
      </div>}
      {!metrics && <p className="mt-3 text-xs text-slate-500">No evaluation metrics are available until the ML service is running successfully.</p>}
    </section>
    <section className="card mt-5"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Recent audit history</h3><p className="mt-1 text-xs text-slate-500">Allocation changes, imports and policy edits recorded by the API.</p></div><span className="text-xs text-slate-500">Latest 200</span></div>
      {!logs?.length ? <p className="py-5 text-sm text-slate-500">No audit records yet.</p> : <div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Change summary</th></tr></thead><tbody>{logs.map((item) => <tr key={item.id}><td>{new Date(item.createdAt + (item.createdAt.endsWith("Z") ? "" : "Z")).toLocaleString()}</td><td>{item.actor ?? "System"}</td><td>{item.action}</td><td>{item.entity}{item.entityId ? ` #${item.entityId}` : ""}</td><td className="max-w-sm truncate text-xs">{item.after ?? "—"}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
