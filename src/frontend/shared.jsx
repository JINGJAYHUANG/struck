import React from 'react';
import { DynamicTable, Lozenge } from '@forge/react';

export const AGENT = { type: 'forge', agentKey: 'struck-agent', agentName: 'Struck' };

const VERDICT = {
  ok: ['Passes', 'success'],
  warn: ['Check', 'moved'],
  fail: ['Fails', 'removed'],
  'cannot-verify': ['Cannot verify', 'removed'],
  exempt: ['Exempt', 'new'],
  none: ['No lines', 'default'],
};

export const VerdictLozenge = ({ verdict }) => {
  const [label, appearance] = VERDICT[verdict] ?? [verdict ?? '—', 'default'];
  return <Lozenge appearance={appearance}>{label}</Lozenge>;
};

export const OverallLozenge = ({ overall, blocking }) => {
  if (overall === 'fail') return <Lozenge appearance="removed">{`Blocked: ${blocking} line${blocking === 1 ? '' : 's'} must be fixed`}</Lozenge>;
  if (overall === 'warn') return <Lozenge appearance="moved">Passes with warnings</Lozenge>;
  if (overall === 'ok') return <Lozenge appearance="success">All claims pass</Lozenge>;
  return <Lozenge>No lines yet</Lozenge>;
};

/** A simple table from header cells and rows of cells. */
export const table = (cells, rows, widths = null) => (
  <DynamicTable
    head={{ cells: cells.map((c, i) => ({ key: `h${i}`, content: c, ...(widths?.[i] ? { width: widths[i] } : {}) })) }}
    rows={rows.map((r, i) => ({ key: `r${i}`, cells: r.map((c, j) => ({ key: `c${i}-${j}`, content: c })) }))}
  />
);

export const claimText = (l) => {
  const parts = [];
  if (l.shownPercent != null) parts.push(`−${l.shownPercent}%`);
  if (l.shownPrior) parts.push(`was ${l.shownPrior}`);
  if (!parts.length && l.claimType === 'statement') parts.push('promotional label');
  return parts.join(', ') || 'no claim';
};

/** Lines as editable text: SKU; new price; shown prior; shown %; campaign start. */
export function linesToText(lines) {
  return (lines ?? []).map((l) => [
    l.sku,
    (l.newPriceMinor / 100).toFixed(2),
    l.shownPriorMinor == null ? '' : (l.shownPriorMinor / 100).toFixed(2),
    l.shownPercent == null ? '' : String(l.shownPercent),
    l.campaignStart ?? '',
  ].join('; ').replace(/(; )+$/, '')).join('\n');
}

export function textToLines(text) {
  const out = [];
  const errors = [];
  String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((row, i) => {
    const [sku, newPrice, shownPrior, shownPercent, campaignStart] = row.split(';').map((c) => c.trim());
    if (!sku || !newPrice) {
      errors.push(`Line ${i + 1}: give at least a SKU and a new price.`);
      return;
    }
    const line = { sku: sku.toUpperCase(), newPrice };
    if (shownPrior) line.shownPrior = shownPrior;
    if (shownPercent) line.shownPercent = Number(shownPercent.replace('%', '').replace('-', '').replace('−', ''));
    if (campaignStart) line.campaignStart = campaignStart;
    line.claimType = line.shownPercent ? 'percent' : line.shownPrior ? 'was-now' : 'none';
    out.push(line);
  });
  return { lines: out, errors };
}
