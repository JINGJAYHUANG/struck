import React, { useEffect, useState } from 'react';
import ForgeReconciler, { SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { LinesForm, Promotion } from './promotion.jsx';

function App() {
  const [data, setData] = useState(null);
  const [rovoEnabled, setRovoEnabled] = useState(false);
  const load = () => invoke('panel', {}).then(setData).catch((e) => setData({ ok: false, error: String(e?.message ?? e) }));
  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoEnabled).catch(() => setRovoEnabled(false));
  }, []);
  if (!data) return <Spinner label="Checking price claims" />;
  if (!data.ok) return <SectionMessage appearance="warning" title="Struck could not load"><Text>{data.error}</Text></SectionMessage>;
  if (!data.result) {
    return (
      <Stack space="space.150">
        <Text>{data.message ?? `No promotion lines on ${data.issueKey} yet. Add them here, or ask the Struck agent to read the brief.`}</Text>
        <LinesForm issueKey={data.issueKey} record={data.record} markets={data.markets} onSaved={load} />
      </Stack>
    );
  }
  return <Promotion data={data} reload={load} rovoEnabled={rovoEnabled} />;
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
