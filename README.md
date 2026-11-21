# Struck

Every "was €X, −Y%" in a promotion, checked against the lowest price of the previous 30 days before it goes live. A Forge app for Jira, with a Rovo agent and Atlassian MCP tools. Struck's code, not a model, computes every number.

- Demo video (2:55): https://youtu.be/WPHIYZpiSXM
- Project page: https://devpost.com/software/struck

## Why

In the EU, a shop that announces a price reduction must use the "prior price" as its reference: the lowest price it applied in at least the 30 days before the reduction (Directive 98/6/EC, Article 6a). In case C-330/23 (Aldi Süd, 26 September 2024) the Court of Justice ruled that a reduction announced as a percentage or as a promotional statement must be calculated from that lowest price. The Court's press release shows bananas at €1.29 with "−23%" and a struck-through €1.69, while the lowest price of the previous 30 days was €1.29: the real reduction was zero.

It keeps happening. In the 2022 Black Friday sweep, consumer authorities found violations on at least 43% of 176 websites. In the 2025 Black Friday and Cyber Monday sweep, 30% of 314 online traders referenced discounts incorrectly (European Commission, 26 March 2026). And an AI copywriter will compute "−18%" from whatever "was" price it is given.

## What it does

- **A promotion is a Jira work item.** Each line has a SKU, the new price and what the copy will claim: a struck-through prior price, a percentage or a promotional label.
- **Code computes every number.** From the stored price history and the market's rule profile, Struck computes for each line the window (calendar days in the market's time zone), the prior price and when it applied, the real reduction, the largest percentage the price supports, and the highest price that would support the claimed percentage. Each problem gets a code (reference overstated, percentage overstated, no reduction, cannot verify, and more).
- **Market profiles with sources.** The EU baseline applies Article 6a. The Germany profile adds the options in § 11 of the Preisangabenverordnung: progressive markdowns, perishable goods, individual reductions.
- **A gate in the workflow.** A Jira workflow validator holds the transition to Approved while any line fails or cannot be verified, and names the lines.
- **Fixes, computed.** One click shows the real prior price, removes the claim, or sets the price that makes the claim true. Labels are built from the computed numbers (English and German).
- **Visible in Jira.** An issue panel with a chart, a global page, an indexed issue property for JQL (`issue.property[struck].blocking > 0`) and a daily re-check.
- **The Struck agent in Rovo** checks a promotion, explains a failed line, reads a free-text brief into lines, and changes data only after the person confirms Rovo's review card.
- **For any agent, through MCP.** Four read actions (get the prior price, check a price claim, check a promotion, explain a line) are listed in a `rovo:mcp` module, so a customer's own Rovo Studio agent can call them before it writes copy.

## How it is built

| Path | What it is |
|---|---|
| `manifest.yml` | Forge modules: `jira:globalPage`, `jira:issuePanel`, `jira:entityProperty`, `jira:workflowValidator`, `scheduledTrigger`, `rovo:agent` (8 actions), `rovo:skill`, `rovo:mcp` |
| `src/engine/` | Pure engine, no Forge imports: windows in the market's time zone, the minimum over price segments, progressive markdowns, rounding policy, integer cents |
| `src/services/` | Checks, explanations, fixes and the sample data |
| `src/actions/` | Rovo actions; `lines-json.js` parses the JSON shapes agents send |
| `src/frontend/` | UI Kit panel and global page (DynamicTable, LineChart, Tabs) |
| `src/store/`, `src/platform/` | Forge storage and Jira REST calls |
| `skills/` | The Rovo skill and an open `SKILL.md` for third-party agents |
| `test/` | 27 tests |

Struck makes no external calls. It stores price histories, promotion lines, check results and a fix log in Forge storage, and one issue property per promotion. It stores no account IDs, names or email addresses.

## Tests

```bash
npm test
```

27 tests with Node's built-in runner (Node.js 22 or later; no install needed). They include the Court of Justice's banana and pineapple numbers, both worked examples on the European Commission's sweep page, a brute-force oracle on 2,000 random price series, and metamorphic checks.

## Deploy your own copy

You need Node.js 22 or later, the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) and a Jira site where you are an admin (a free developer site works).

```bash
npm install
forge register
forge deploy -e development
forge install -e development --site your-site.atlassian.net --product jira
```

`forge register` writes your own app ID into `manifest.yml`. Then follow [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md): create a project, load the sample data, and try the panel, the workflow gate, JQL and the Rovo agent.

## Sources

- Court of Justice of the EU, press release No 152/24, Case C-330/23 Aldi Süd: https://curia.europa.eu/jcms/upload/docs/application/pdf/2024-09/cp240152en.pdf
- European Commission, "Sweeps": https://commission.europa.eu/topics/consumers/consumer-rights-and-complaints/enforcement-consumer-protection/sweeps_en
- European Commission, press release IP/26/734: https://ec.europa.eu/commission/presscorner/detail/en/ip_26_734
- Directive 98/6/EC, Article 6a: https://eur-lex.europa.eu/eli/dir/1998/6/oj
- Preisangabenverordnung § 11: https://www.gesetze-im-internet.de/pangv_2022/__11.html

Struck reports what the configured rules compute from your data. It is not legal advice.

## License

Apache-2.0. Built for Codegeist 2026 with Claude Code as an AI pair programmer. The demo narration is synthetic.
