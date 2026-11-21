# Struck walkthrough

Struck checks the price-reduction claims in a promotion ("−23%", a struck-through "was" price, a "price highlight" label) against the lowest price the shop charged in the 30 days before the reduction, as EU law requires (Directive 98/6/EC, Article 6a; Court of Justice, C-330/23 Aldi Süd, 2024). Struck's code, not a model, computes every number. People, the Struck agent in Rovo and a customer's own Rovo Studio agent all get the same answer.

## Requirements

- A Jira site where you are an admin. Rovo is optional (steps 9 and 10).
- About 10 minutes for steps 1 to 8.
- For the Rovo steps, a browser window at least 1,280 px wide, so the Rovo panel can open next to the work item.

## 1. Install (1 minute)

Deploy and install your own copy as described in the README (`forge register`, `forge deploy`, `forge install`) and approve the scopes:

- `read:jira-work`, `write:jira-work`: read promotion work items; write Struck's issue property (for JQL and the workflow gate); create the sample work items and fix tasks;
- `storage:app`: price histories, promotion lines and the fix log.

Struck calls no external services and uses no LLM of its own; Rovo does the language work.

## 2. Create a project (1 minute)

Create a **company-managed** project named **Promotions** with the key **PROMO**. Jira's **Campaign management** template (Marketing category) works well; any company-managed template with an approval-like status works. In a new project, the sample work items become PROMO-1 to PROMO-5.

## 3. Load the sample data (1 minute)

Open **Apps > Struck**, go to the **Sample data** tab, choose **Promotions (PROMO)** and click **Load sample data**. After about 20 seconds it says "Created PROMO-1, PROMO-2, PROMO-3, PROMO-4, PROMO-5 in PROMO."

The sample has 8 products with price histories in two market profiles (Germany and the EU baseline) and 5 promotions. The banana and pineapple prices are the ones in the Court of Justice's press release on C-330/23. All other products and prices are fictional. Dates are fixed (November and December 2026), so the results are the same on any day.

## 4. The promotions (1 minute)

Open the **Promotions** tab: "4 of 5 promotions blocked".

| Work item | Promotion | Result |
|---|---|---|
| PROMO-1 | Black Friday – fresh produce (DE) | Blocked: 2 lines must be fixed |
| PROMO-2 | Winter jackets – progressive markdown (DE) | Blocked: 1 line must be fixed |
| PROMO-3 | Cyber Monday – electronics (EU) | Blocked: 1 line must be fixed |
| PROMO-4 | Launch offer – headphones (EU) | Blocked: 1 line must be fixed |
| PROMO-5 | Weekend deal – TV (EU), brief only | No lines yet |

The **Rule profiles** tab shows what each market profile applies and its sources. The **Price data** tab lists the price histories.

## 5. The Court's bananas (the key moment)

Open **PROMO-1**. Below the title, click the **Apps** button and choose **Struck price claims** to add the panel.

| Product | New price | Claim shown | Prior price (lowest in window) | Real cut | Result |
|---|---|---|---|---|---|
| BANANA-1KG | €1.29 | −23%, was €1.69 | €1.29 | 0% | Fails |
| PINEAPPLE | €1.49 | was €1.69 | €1.39 | −7.2% | Fails |
| COFFEE-1KG | €10.99 | −15%, was €12.99 | €12.99 | 15.4% | Passes |

The detail for BANANA-1KG says "Prior price: €1.29, the lowest from 2026-10-28 to 2026-11-26" and lists:

- S2 reference overstated: "Shows €1.69 as the prior price, but the lowest price from 2026-10-28 to 2026-11-26 was €1.29."
- S5 no reduction: "The new price €1.29 equals the prior price €1.29: there is no reduction to announce."
- S4 percent overstated: "For −23% the price must be at most €0.99."

The chart shows the daily price (€1.29, then €1.69 from 20 November) and the prior price across the window. Under **Computed fixes**, two buttons: remove the claim, or keep −23% by setting the price to €0.99 and showing €1.29 as the prior price.

## 6. The workflow gate (2 minutes)

Add Struck's rule to the project's workflow: **Space settings > Workflows > Edit workflow > Add Rule**. Under **Marketplace rules**, choose **Struck**, then **Struck price claims pass**. For **Transition**, choose **Any status → Approved**, click **Add**, then **Update workflow**.

Back on PROMO-1, change the status to **Approved**. Jira refuses: "Transition failed. Struck: 2 price claims must be fixed before publishing: BANANA-1KG (S2, S5, S4); PINEAPPLE (S2, S5). Open the Struck panel for the numbers."

In the panel, select PINEAPPLE and click **Apply** next to "Remove the reduction claim". Select BANANA-1KG and click **Apply** next to "Keep −23%: set the price to €0.99 (or less) and show €1.29 as the prior price". Both lines now pass (bananas: −23% from €1.29 to €0.99), and the transition to Approved works.

## 7. Search with JQL (30 seconds)

In **Filters > Search work items**, switch to JQL and run:

```
issue.property[struck].blocking > 0 ORDER BY key ASC
```

It lists every promotion that still has blocking lines (PROMO-2, PROMO-3 and PROMO-4 after step 6).

## 8. Three more rules (2 minutes)

- **PROMO-2, progressive markdown (Germany).** JACKET-ALPINE passes: its −30% continues an uninterrupted markdown that began on 13 November, so under PAngV § 11(2) the prior price is the €100 from before the first step (window 2026-10-14 to 2026-11-12). JACKET-HARBOUR fails: its markdown (€90, €80, €70 from 29 October) ended when the price went back up to €100 on 19 November, so the lowest price in its window is €70 and "−30% from 100" at €70 is no reduction.
- **PROMO-3, Cyber Monday (EU baseline).** ESPRESSO-PRO fails: its €279 Halloween price (24 to 31 October) was still applied on the first day of the window, so "€299, was €399, −25%" is a 7.2% price rise; to keep −25%, the price must be at most €209.25. TV-55 passes (−12% against €799).
- **PROMO-4, launch offer.** HEADPHONES-ANC cannot be verified: it launched on 15 November, inside the 30-day window, and the EU baseline has no shorter period for new products. Struck blocks it until the history covers the window.

## 9. Ask Struck (Rovo, optional, 3 minutes)

Open **PROMO-5**. Its description is a free-text brief: the 55-inch TV at 649, "was 799" and a "−18%" badge from Saturday 5 December. Open **Ask Rovo**, choose the **Struck** agent and ask: "Read the brief of this promotion into lines and check them."

1. The agent lists the line it read (TV-55, new price 649.00, shown prior price 799.00, −18%) and asks before saving.
2. Say "Yes, save and check them." Rovo shows a review card (**Save promotion lines**). Try **Cancel** first: the agent says nothing was saved. Ask again and click **Confirm selected**.
3. The check fails: the TV sold at €699 on Cyber Monday (30 November to 2 December), which is inside the window (2026-11-05 to 2026-12-04). The real cut is 7.2%; to keep −18% the price must be at most €573.18. Earlier promotions count.
4. Ask "Can you create fix tasks?" and confirm the review card: Struck creates a sub-task with the computed numbers and both fixes.

## 10. Another agent reuses Struck's tools (Rovo Studio, optional, 3 minutes)

In Rovo, open the agent menu and choose **Create agent > Start from blank**. Under **Tools > Add tools**, search "price" and add **Get the prior price** and **Check a price claim**. As instructions, paste:

> You write short promotional copy. Before you write any reduction, call "Get the prior price" for the market, SKU and promotion date, then "Check a price claim" with the claim you plan to write. Never compute a discount yourself. If the check fails, write the copy with the numbers the tool returned.

Click **Test** and ask: "Write a one-line banner for the 55-inch TV (SKU TV-55, market EU-BASE) on sale at 649.00 from 2026-12-05. The old price was 799, so say 'was 799, −18%'." The agent rejects the claim and writes the banner with the real numbers (on our site: "55-inch TV: Now €649.00 (was €699.00, −7%)"). You do not need to publish this agent.

## Optional: import price history

On the **Price data** tab, paste CSV rows `market,sku,name,effective_from,price[,launched_at]` and click **Import**. Each product's rows replace its stored history, and every promotion is re-checked.

## Clean up

On the **Sample data** tab, click **Remove sample data**. It deletes the five sample work items (and their fix tasks) and the sample price histories. Imported histories stay.

## Privacy

Struck runs entirely on Forge and makes no external calls. It stores price histories, promotion lines, check results and a fix log in Forge storage, and one issue property per promotion. It stores no account IDs, names or email addresses. Struck reports what the configured rules compute from your data; it is not legal advice.
