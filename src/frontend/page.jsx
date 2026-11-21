import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, EmptyState, Heading, Inline, Label, Link, Lozenge, SectionMessage, Select, Spinner, Stack, Strong,
  Tab, TabList, TabPanel, Tabs, Text, TextArea,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { OverallLozenge, table } from './shared.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CSV_EXAMPLE = 'market,sku,name,effective_from,price,launched_at\nDE,BANANA-1KG,Bananas 1 kg,2026-10-01,1.29\nDE,BANANA-1KG,Bananas 1 kg,2026-11-20,1.69';

function Promotions({ data, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!data.promotions.length) {
    return <EmptyState header="No promotions checked yet" description="Load the sample data (Sample data tab), or open a promotion work item and add its lines in the Struck panel." />;
  }
  const blocked = data.promotions.filter((p) => p.overall === 'fail').length;
  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={blocked ? 'removed' : 'success'}>{`${blocked} of ${data.promotions.length} promotions blocked`}</Lozenge>
        <Text>{'JQL for blocked promotions: issue.property[struck].blocking > 0'}</Text>
      </Inline>
      {table(['Work item', 'Promotion', 'Market', 'Starts', 'Lines', 'Result', 'Checked (UTC)'], data.promotions.map((p) => [
        <Link href={`/browse/${p.key}`} openNewTab={false}>{p.key}</Link>, p.summary, p.market ?? '—', p.startsAt ?? '—', String(p.lines),
        <OverallLozenge overall={p.overall} blocking={p.blocking} />, p.checkedAt ? p.checkedAt.slice(0, 16).replace('T', ' ') : '—',
      ]), [10, 26, 8, 10, 6, 24, 16])}
      <ButtonGroup>
        <Button isDisabled={busy} onClick={async () => { setBusy(true); await invoke('recheckAll', {}); setBusy(false); onChanged(); }}>{busy ? 'Re-checking…' : 'Re-check all'}</Button>
      </ButtonGroup>
    </Stack>
  );
}

function PriceData({ data, onChanged }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await invoke('importCsv', { text }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(false);
    setMsg(r.ok ? { appearance: 'success', text: `Imported ${plural(r.rows, 'row')} for ${plural(r.products, 'product')}; re-checked ${plural(r.rechecked, 'promotion')}.` } : { appearance: 'error', text: r.error });
    if (r.ok) onChanged();
  };
  return (
    <Stack space="space.300">
      {Object.entries(data.products).map(([market, list]) => (
        <Stack key={market} space="space.100">
          <Heading as="h4">{`${market}: ${plural(list.length, 'product')}`}</Heading>
          {list.length ? table(['SKU', 'Product', 'History from', 'Price changes', 'Last scheduled price', 'From', 'Launched', 'Source'], list.map((p) => [
            p.sku, p.name, p.first ?? '—', String(p.changes), p.latestPrice ?? '—', p.latestFrom ?? '—', p.launchedAt ?? '—', p.source,
          ])) : <Text>No price history yet.</Text>}
        </Stack>
      ))}
      <Stack space="space.100">
        <Heading as="h4">Import price history (CSV)</Heading>
        <Text>Each product's rows replace its stored history. Dates are local to the market; prices are decimals. Every promotion is re-checked afterwards.</Text>
        <Label labelFor="csv">CSV rows: market,sku,name,effective_from,price[,launched_at]</Label>
        <TextArea id="csv" value={text} onChange={(e) => setText(e.target.value)} placeholder={CSV_EXAMPLE} />
        {msg ? <SectionMessage appearance={msg.appearance}><Text>{msg.text}</Text></SectionMessage> : null}
        <ButtonGroup>
          <Button appearance="primary" isDisabled={busy || !text.trim()} onClick={run}>{busy ? 'Importing…' : 'Import'}</Button>
        </ButtonGroup>
      </Stack>
    </Stack>
  );
}

function Profiles({ data }) {
  return (
    <Stack space="space.300">
      <Text>Struck computes the prior price as the lowest price applied in the window before a reduction, and checks every claim against it. Each market profile records which national options apply and where they come from.</Text>
      {data.profiles.map((p) => (
        <Stack key={p.code} space="space.100">
          <Inline space="space.100" alignBlock="center">
            <Heading as="h4">{`${p.code}: ${p.name}`}</Heading>
            <Lozenge appearance={p.status === 'verified' ? 'success' : 'default'}>{p.status}</Lozenge>
          </Inline>
          <Text>{`Window: ${p.windowDays} days before the reduction, in ${p.timeZone}. Progressive reductions: ${p.options.progressiveReductions ? 'yes' : 'no'}. Perishable exemption: ${p.options.perishableExemption ? 'yes' : 'no'}. Individual reductions exempt: ${p.options.individualExemption ? 'yes' : 'no'}. Shorter window for new products: ${p.options.newProductShorterWindow ? 'yes' : 'no'}.`}</Text>
          {p.notes.map((n) => <Text key={n}>{`• ${n}`}</Text>)}
          <Text><Strong>Sources</Strong></Text>
          {p.sources.map((s) => <Link key={s.id} href={s.url} openNewTab>{s.title}</Link>)}
        </Stack>
      ))}
      <SectionMessage appearance="information"><Text>Struck reports what these rules compute from your data. It is not legal advice; other markets need a profile your own reviewers have checked.</Text></SectionMessage>
    </Stack>
  );
}

function Sample({ data, onChanged }) {
  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    invoke('projects', {}).then((r) => setProjects(r.projects ?? [])).catch(() => setProjects([]));
  }, []);
  const load = async () => {
    setBusy(true);
    const r = await invoke('loadSample', { projectKey: project }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(false);
    setMsg(r.ok ? { appearance: 'success', text: `Created ${r.issueKeys.join(', ')} in ${r.projectKey}.${r.problems?.length ? ` Problems: ${r.problems.join(' ')}` : ''}` } : { appearance: 'error', text: r.error });
    onChanged();
  };
  const remove = async () => {
    setBusy(true);
    const r = await invoke('removeSample', {}).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    setBusy(false);
    setMsg(r.ok ? { appearance: 'success', text: `Removed ${r.removed.length} work items and the sample price histories.` } : { appearance: 'error', text: r.error });
    onChanged();
  };
  return (
    <Stack space="space.200">
      <Text>The sample adds 8 products with price histories (Germany and EU baseline) and 5 promotion work items: Black Friday fresh produce (the Court of Justice's banana and pineapple prices), a progressive jacket markdown, Cyber Monday electronics, a launch offer, and a brief for the agent to read into lines.</Text>
      {data.sample.loaded ? (
        <Stack space="space.100">
          <Text>{`Loaded in ${data.sample.projectKey}: ${data.sample.issueKeys.join(', ')}.`}</Text>
          <ButtonGroup><Button appearance="warning" isDisabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove sample data'}</Button></ButtonGroup>
        </Stack>
      ) : (
        <Stack space="space.100">
          <Label labelFor="project">Project for the sample promotions</Label>
          {projects === null ? <Spinner /> : <Select id="project" options={projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))} onChange={(o) => setProject(o.value)} />}
          <ButtonGroup><Button appearance="primary" isDisabled={busy || !project} onClick={load}>{busy ? 'Loading…' : 'Load sample data'}</Button></ButtonGroup>
        </Stack>
      )}
      {msg ? <SectionMessage appearance={msg.appearance}><Text>{msg.text}</Text></SectionMessage> : null}
    </Stack>
  );
}

function App() {
  const [data, setData] = useState(null);
  const load = () => invoke('page', {}).then(setData).catch((e) => setData({ ok: false, error: String(e?.message ?? e) }));
  useEffect(() => {
    load();
  }, []);
  if (!data) return <Spinner label="Loading Struck" />;
  if (!data.ok) return <SectionMessage appearance="warning" title="Struck could not load"><Text>{data.error}</Text></SectionMessage>;
  return (
    <Stack space="space.200">
      <Heading as="h2">Price-reduction claims</Heading>
      <Text>Every announced reduction is checked against the lowest price charged in the window before it. Code computes every verdict; promotions with failing lines are held in Jira until they are fixed.</Text>
      <Tabs id="struck-tabs">
        <TabList>
          <Tab>Promotions</Tab>
          <Tab>Price data</Tab>
          <Tab>Rule profiles</Tab>
          <Tab>Sample data</Tab>
        </TabList>
        <TabPanel><Box paddingBlockStart="space.200"><Promotions data={data} onChanged={load} /></Box></TabPanel>
        <TabPanel><Box paddingBlockStart="space.200"><PriceData data={data} onChanged={load} /></Box></TabPanel>
        <TabPanel><Box paddingBlockStart="space.200"><Profiles data={data} /></Box></TabPanel>
        <TabPanel><Box paddingBlockStart="space.200"><Sample data={data} onChanged={load} /></Box></TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
