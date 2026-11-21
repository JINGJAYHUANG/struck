import React, { useState } from 'react';
import {
  Box, Button, ButtonGroup, DatePicker, Heading, Inline, Label, LineChart, SectionMessage, Select, Stack, Strong, Text,
  TextArea, Lozenge,
} from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { AGENT, OverallLozenge, VerdictLozenge, claimText, linesToText, table, textToLines } from './shared.jsx';

const LEVEL_APPEARANCE = { fail: 'error', warn: 'warning', info: 'information', ok: 'success' };

/** Edit a promotion's market, start date and lines; used on an empty work item and for "Edit lines". */
export function LinesForm({ issueKey, record, markets, onSaved, onCancel }) {
  const [market, setMarket] = useState(record?.market ?? 'DE');
  const [startsAt, setStartsAt] = useState(record?.startsAt ?? '');
  const [text, setText] = useState(linesToText(record?.lines));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    const { lines, errors } = textToLines(text);
    if (errors.length) return setError(errors.join(' '));
    if (!startsAt) return setError('Pick the date the promotion starts.');
    setBusy(true);
    setError(null);
    const r = await invoke('saveLines', { issueKey, market, startsAt, lines }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    return onSaved(r);
  };
  const skus = markets?.[market] ?? [];
  return (
    <Stack space="space.150">
      <Inline space="space.200" alignBlock="end">
        <Stack space="space.050">
          <Label labelFor="market">Market profile</Label>
          <Select id="market" value={{ label: market, value: market }} options={Object.keys(markets ?? { DE: [], 'EU-BASE': [] }).map((m) => ({ label: m, value: m }))} onChange={(o) => setMarket(o.value)} />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="starts">Promotion starts</Label>
          <DatePicker id="starts" value={startsAt} onChange={(v) => setStartsAt(v)} />
        </Stack>
      </Inline>
      <Label labelFor="lines">One line per product: SKU; new price; shown prior price; shown %; first step of a progressive markdown (optional)</Label>
      <TextArea id="lines" value={text} onChange={(e) => setText(e.target.value)} placeholder="TV-55; 699.00; 799.00; 12" />
      <Text>{skus.length ? `Products with price history in ${market}: ${skus.join(', ')}` : `No price history in ${market} yet. Import it on the Struck page (Apps → Struck).`}</Text>
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      <ButtonGroup>
        <Button appearance="primary" onClick={save} isDisabled={busy}>{busy ? 'Checking…' : 'Save and check'}</Button>
        {onCancel ? <Button appearance="subtle" onClick={onCancel}>Cancel</Button> : null}
      </ButtonGroup>
    </Stack>
  );
}

function LineDetail({ line, chart, issueKey, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const apply = async (fix) => {
    setBusy(fix);
    setError(null);
    const r = await invoke('applyFix', { issueKey, sku: line.sku, fix }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    return onChanged(r);
  };
  const shown = line.codes.filter((c) => c.level !== 'ok');
  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        <Heading as="h4">{`${line.product} (${line.sku})`}</Heading>
        <VerdictLozenge verdict={line.verdict} />
      </Inline>
      <Text>
        {line.priorPrice
          ? `Prior price: ${line.priorPrice}, the lowest from ${line.window}${line.anchoredToCampaignStart ? ' (before the first step of the progressive markdown)' : ''}. ${line.realCutPercent == null ? 'This line announces no reduction.' : `Real cut: ${line.realCutPercent}%.`}`
          : 'No prior price could be computed.'}
      </Text>
      {shown.map((c) => (
        <SectionMessage key={c.code + c.key} appearance={LEVEL_APPEARANCE[c.level] ?? 'information'} title={`${c.code} ${c.key.replace(/_/g, ' ').toLowerCase()}`}>
          <Text>{c.message}</Text>
        </SectionMessage>
      ))}
      {line.suggestions?.length ? (
        <Stack space="space.100">
          <Text><Strong>Computed fixes</Strong></Text>
          {line.suggestions.map((s) => (
            <Inline key={s.fix} space="space.100" alignBlock="center">
              <Button appearance="primary" spacing="compact" isDisabled={Boolean(busy)} onClick={() => apply(s.fix)}>{busy === s.fix ? 'Applying…' : 'Apply'}</Button>
              <Text>{s.text}</Text>
            </Inline>
          ))}
        </Stack>
      ) : null}
      {line.labels?.en ? <Text>{`Label from the computed numbers: ${line.labels.en}  |  ${line.labels.de}`}</Text> : null}
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
      {chart?.length ? <LineChart data={chart} xAccessor="day" yAccessor="value" colorAccessor="series" title={`${line.sku}: daily price; the flat line spans the window at its lowest price`} height={260} /> : null}
    </Stack>
  );
}

/** The checked promotion: overall result, one row per line, and the selected line in detail. */
export function Promotion({ data, reload, rovoEnabled }) {
  const r = data.result;
  const firstBad = r.lines.find((l) => l.verdict === 'fail' || l.verdict === 'cannot-verify') ?? r.lines[0];
  const [selected, setSelected] = useState(firstBad?.sku);
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <LinesForm issueKey={data.issueKey} record={data.record} markets={data.markets} onSaved={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />;
  }
  const line = r.lines.find((l) => l.sku === selected) ?? firstBad;
  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <OverallLozenge overall={r.overall} blocking={r.blockingLines} />
        <Lozenge appearance={r.profileStatus === 'verified' ? 'success' : 'default'}>{`${r.market} profile: ${r.profileStatus}`}</Lozenge>
        <Text>{`Starts ${r.startsAt}`}</Text>
      </Inline>
      {table(['Product', 'New price', 'Claim shown', 'Prior price (lowest in window)', 'Real cut', 'Result'], r.lines.map((l) => [
        <Button appearance={l.sku === line?.sku ? 'default' : 'subtle'} spacing="compact" onClick={() => setSelected(l.sku)}>{l.sku}</Button>,
        l.newPrice, claimText(l), l.priorPrice ?? '—', l.realCutPercent == null ? '—' : `${l.realCutPercent}%`, <VerdictLozenge verdict={l.verdict} />,
      ]))}
      {line ? <Box padding="space.150" backgroundColor="color.background.neutral.subtle"><LineDetail line={line} chart={data.charts?.[line.sku]} issueKey={data.issueKey} onChanged={reload} /></Box> : null}
      <ButtonGroup>
        <Button onClick={reload}>Re-check</Button>
        <Button onClick={() => setEditing(true)}>Edit lines</Button>
        {rovoEnabled ? <Button appearance="discovery" onClick={() => rovo.open({ ...AGENT, prompt: `Check ${data.issueKey} and explain what must change before it can go live.` })}>Ask Struck</Button> : null}
      </ButtonGroup>
      <Text>{`Computed by Struck ${r.engineVersion} from the stored price history and the ${r.market} profile (${r.sources.join('; ')}). Not legal advice.`}</Text>
    </Stack>
  );
}
