import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

let server;
let baseUrl;
let tempDir;

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(pathname, { cookie, ...options } = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...options.headers };
  const response = await fetch(`${baseUrl}/api${pathname}`, { ...options, headers });
  let payload = null;
  if (response.status !== 204) {
    const type = response.headers.get("content-type") ?? "";
    payload = type.includes("application/json") ? await response.json() : await response.text();
  }
  return { response, payload };
}

async function uploadRequest(pathname, cookie, fields, fileName, fileContent) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([fileContent]), fileName);
  const response = await fetch(`${baseUrl}/api${pathname}`, { method: "POST", headers: { cookie }, body: form });
  const payload = await response.json();
  return { response, payload };
}

function makeXlsx(headers, row) {
  const columnName = (index) => {
    let result = "";
    while (index > 0) { const remainder = (index - 1) % 26; result = String.fromCharCode(65 + remainder) + result; index = Math.floor((index - 1) / 26); }
    return result;
  };
  const cell = (value, rowIndex, columnIndex) => {
    const ref = `${columnName(columnIndex + 1)}${rowIndex}`;
    if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
    const escaped = String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<c r="${ref}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
  };
  const worksheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headers.map((value, index) => cell(value, 1, index)).join("")}</row><row r="2">${row.map((value, index) => cell(value, 2, index)).join("")}</row></sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Courses" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheet)
  });
}

async function login(email, password = "FacultyDemo2026!") {
  const { response, payload } = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faculty-workload-test-"));
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_FILE: path.join(tempDir, "test.sqlite"),
      SEED_DEMO: "true",
      NODE_ENV: "test",
      JWT_SECRET: "integration-test-secret",
      CLIENT_ORIGIN: "http://localhost:5173",
      ML_SERVICE_URL: "http://127.0.0.1:1"
    },
    stdio: "ignore"
  });
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`API process exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) { healthy = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, "API did not start in time");
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("authenticated dashboards are tenant-scoped and faculty profiles are private", async () => {
  const adminCookie = await login("admin@northstar.demo");
  const dashboard = await request("/dashboard", { cookie: adminCookie });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.payload.workloadStats.faculty, 4);
  assert.equal(dashboard.payload.allocations.totalSections, 5);

  const facultyCookie = await login("ava@northstar.demo");
  const faculty = await request("/faculty", { cookie: facultyCookie });
  assert.equal(faculty.response.status, 200);
  assert.deepEqual(faculty.payload.map((person) => person.email), ["ava@northstar.demo"]);
  const forbidden = await request("/faculty/4/availability", { cookie: facultyCookie });
  assert.equal(forbidden.response.status, 403);
  const blockedAction = await request("/departments", { cookie: facultyCookie, method: "POST", body: JSON.stringify({ name: "Unauthorized" }) });
  assert.equal(blockedAction.response.status, 403);
});

test("manual assignment changes require approval and stale drafts cannot overwrite newer allocations", async () => {
  const cookie = await login("admin@northstar.demo");
  const allocations = await request("/allocations", { cookie });
  const section = allocations.payload.find((item) => item.courseCode === "CS101");
  const faculty = await request("/faculty", { cookie });
  const target = faculty.payload.find((person) => person.email === "ethan@northstar.demo");
  assert.ok(section);
  assert.ok(target);

  const body = JSON.stringify({ sectionId: section.sectionId, facultyId: target.id });
  const firstDraft = await request("/allocations", { cookie, method: "POST", body });
  const staleDraft = await request("/allocations", { cookie, method: "POST", body });
  assert.equal(firstDraft.response.status, 202, JSON.stringify(firstDraft.payload));
  assert.equal(staleDraft.response.status, 202, JSON.stringify(staleDraft.payload));
  let current = await request("/allocations", { cookie });
  assert.equal(current.payload.find((item) => item.sectionId === section.sectionId).facultyId, section.facultyId);

  const approved = await request(`/recommendations/${firstDraft.payload.recommendationId}/review`, {
    cookie, method: "POST", body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.allocationsChanged, 1);
  const staleApproval = await request(`/recommendations/${staleDraft.payload.recommendationId}/review`, {
    cookie, method: "POST", body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(staleApproval.response.status, 409);
  current = await request("/allocations", { cookie });
  assert.equal(current.payload.find((item) => item.sectionId === section.sectionId).facultyId, target.id);

  const unassignment = await request(`/allocations/${section.sectionId}`, { cookie, method: "DELETE" });
  assert.equal(unassignment.response.status, 202);
  current = await request("/allocations", { cookie });
  assert.equal(current.payload.find((item) => item.sectionId === section.sectionId).facultyId, target.id);
  const rejected = await request(`/recommendations/${unassignment.payload.recommendationId}/review`, {
    cookie, method: "POST", body: JSON.stringify({ decision: "reject" })
  });
  assert.equal(rejected.payload.status, "rejected");
});

test("draft generation does not change official allocations until approved", async () => {
  const cookie = await login("admin@northstar.demo");
  const before = await request("/allocations", { cookie });
  const created = await request("/workflows/generate", { cookie, method: "POST", body: "{}" });
  assert.equal(created.response.status, 201);
  assert.match(created.payload.notice, /not guaranteed optimal/i);
  const dataScience = created.payload.proposals.find((proposal) => proposal.sectionName.startsWith("DS210-A"));
  assert.equal(dataScience.facultyName, "Noah Patel", "matching expertise should receive the data science section");
  const afterDraft = await request("/allocations", { cookie });
  assert.equal(afterDraft.payload.length, before.payload.length);

  const pending = await request("/recommendations", { cookie });
  const draft = pending.payload.find((item) => item.id === created.payload.recommendationId);
  assert.equal(draft.status, "pending");
  const approved = await request(`/recommendations/${draft.id}/review`, { cookie, method: "POST", body: JSON.stringify({ decision: "approve" }) });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.status, "approved");
  const afterApproval = await request("/allocations", { cookie });
  assert.ok(afterApproval.payload.length >= before.payload.length);
  const unchanged = created.payload.proposals.find((proposal) => proposal.previousFacultyId && proposal.previousFacultyId === proposal.facultyId);
  if (unchanged) {
    const oldAllocation = before.payload.find((item) => item.sectionId === unchanged.sectionId);
    const keptAllocation = afterApproval.payload.find((item) => item.sectionId === unchanged.sectionId);
    assert.equal(keptAllocation.id, oldAllocation.id, "unchanged assignment should not be rewritten");
  }
});

test("new institutions stay isolated and development verification is explicit", async () => {
  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      institution: "Second Campus", department: "Arts", name: "Campus Admin",
      email: "campus@example.edu", password: "LongPassword!2026"
    })
  });
  assert.equal(registration.response.status, 201);
  const verification = await request("/auth/verify-development", {
    method: "POST",
    body: JSON.stringify({ institutionId: registration.payload.institutionId, code: "DEV-VERIFY" })
  });
  assert.equal(verification.response.status, 200);
  const cookie = await login("campus@example.edu", "LongPassword!2026");
  const sections = await request("/sections", { cookie });
  assert.equal(sections.response.status, 200);
  assert.deepEqual(sections.payload, []);
  const courses = await request("/courses", { cookie });
  assert.equal(courses.response.status, 200);
  assert.deepEqual(courses.payload, []);
  const analysis = await request("/workflows/analyze", { cookie, method: "POST", body: "{}" });
  assert.equal(analysis.response.status, 400);
  assert.match(analysis.payload.error, /requires at least one official allocation/i);
});

test("validation and unavailable ML are explicit without blocking core API", async () => {
  const cookie = await login("admin@northstar.demo");
  const badPolicy = await request("/policy", {
    cookie, method: "PUT",
    body: JSON.stringify({ balancedMin: 20, balancedMax: 10, overloadThreshold: 18, dutyHoursCounted: true })
  });
  assert.equal(badPolicy.response.status, 400);
  const ml = await request("/ml/status", { cookie });
  assert.equal(ml.response.status, 200);
  assert.equal(ml.payload.available, false);
  const health = await request("/health");
  assert.equal(health.response.status, 200);
});

test("XLSX import supports column mapping, validation preview and explicit confirmation", async () => {
  const cookie = await login("admin@northstar.demo");
  const workbook = makeXlsx(
    ["Course Code", "Course Name", "Subject Area", "Department"],
    ["XLSX501", "Spreadsheet Systems", "Software Engineering", "Computer Science"]
  );
  const headers = await uploadRequest("/import/headers", cookie, {}, "courses.xlsx", workbook);
  assert.equal(headers.response.status, 200, JSON.stringify(headers.payload));
  assert.deepEqual(headers.payload.headers, ["Course Code", "Course Name", "Subject Area", "Department"]);
  const mapping = { code: "Course Code", name: "Course Name", subject: "Subject Area", department: "Department" };
  const preview = await uploadRequest("/import/preview", cookie, { entity: "courses", mapping: JSON.stringify(mapping) }, "courses.xlsx", workbook);
  assert.equal(preview.response.status, 201);
  assert.equal(preview.payload.validRows, 1);
  assert.equal(preview.payload.errors.length, 0);
  const confirmed = await request(`/import/${preview.payload.batchId}/confirm`, { cookie, method: "POST", body: "{}" });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.payload.imported, 1);
  const courses = await request("/courses", { cookie });
  assert.ok(courses.payload.some((item) => item.code === "XLSX501"));
});
