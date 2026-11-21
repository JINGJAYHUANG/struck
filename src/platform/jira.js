// Jira REST calls. UI and agent calls run as the current user (people act under their own permissions);
// issue-property writes, the validator and the scheduled re-check run as the app. Struck calls only Atlassian APIs.

import api, { route } from '@forge/api';

export const PROP_KEY = 'struck';
const requester = (asApp) => (asApp ? api.asApp() : api.asUser());
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const FIELDS = ['summary', 'status', 'project', 'issuetype', 'description', 'parent'];

async function parse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

const errorText = (body, status) => (body.errorMessages ?? []).concat(Object.values(body.errors ?? {})).join(' ') || `HTTP ${status}`;

export function itemOut(issue) {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    id: String(issue.id),
    summary: f.summary ?? issue.key,
    status: f.status?.name ?? '',
    projectKey: f.project?.key ?? null,
    issueType: f.issuetype?.name ?? '',
    subtask: Boolean(f.issuetype?.subtask),
    parentKey: f.parent?.key ?? null,
    description: f.description ?? null,
    prop: issue.properties?.[PROP_KEY] ?? null,
  };
}

export async function getItem(key, { asApp = false } = {}) {
  const res = await requester(asApp).requestJira(route`/rest/api/3/issue/${String(key)}?fields=${FIELDS.join(',')}&properties=${PROP_KEY}`);
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, item: itemOut(await res.json()) };
}

export async function listProjects() {
  const res = await api.asUser().requestJira(route`/rest/api/3/project/search?maxResults=100&orderBy=name`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.values ?? []).map((p) => ({ key: p.key, name: p.name, id: String(p.id) }));
}

export async function setProperty(key, value) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${String(key)}/properties/${PROP_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) console.log(`setProperty ${key} failed ${res.status}`);
  return { ok: res.ok, status: res.status };
}

export async function deleteProperty(key) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${String(key)}/properties/${PROP_KEY}`, { method: 'DELETE' });
  return { ok: res.ok || res.status === 404, status: res.status };
}

/** Creates a work item as the user. A sub-task needs `parentKey`; its type name differs between sites. */
export async function createItem({ projectKey, summary, description, issueType = 'Task', parentKey = null, labels = [] }) {
  const post = (type) => api.asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        issuetype: { name: type },
        summary: String(summary).slice(0, 250),
        ...(parentKey ? { parent: { key: parentKey } } : {}),
        ...(description ? { description: adfParagraphs(description) } : {}),
        ...(labels.length ? { labels } : {}),
      },
    }),
  });
  const types = parentKey ? ['Subtask', 'Sub-task'] : [issueType, 'Task'];
  let res;
  let body;
  for (const type of [...new Set(types)]) {
    res = await post(type);
    if (res.ok) break;
    body = await parse(res);
    if (res.status !== 400) break;
  }
  if (!res.ok) return { ok: false, status: res.status, error: errorText(body ?? {}, res.status) };
  const created = await res.json();
  return { ok: true, key: created.key, id: String(created.id) };
}

export async function addComment(key, text, { asApp = false } = {}) {
  const res = await requester(asApp).requestJira(route`/rest/api/3/issue/${String(key)}/comment`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body: adfParagraphs(text) }),
  });
  return { ok: res.ok, status: res.status };
}

export async function deleteItem(key) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${String(key)}?deleteSubtasks=true`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) console.log(`deleteItem ${key} failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { ok: res.ok || res.status === 404, status: res.status };
}

export function adfParagraphs(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { type: 'doc', version: 1, content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) };
}

/** Plain text of an ADF document (descriptions), for the agent to read a brief. */
export function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  const inner = (node.content ?? []).map(adfText).join(node.type === 'doc' ? '\n' : '');
  return ['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type) ? `${inner}\n` : inner;
}
