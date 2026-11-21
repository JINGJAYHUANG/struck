---
name: struck-price-claims
description: Check a price-reduction claim (a percentage, a struck-through "was" price or a promotional label such as "deal") against the lowest price charged in the 30 days before the reduction, using Struck's computed prior price. Use it before writing or approving promotional copy, a banner, a flyer line or a product page that announces a reduction in the EU or EEA.
license: Apache-2.0
---
# Check a price-reduction claim

The reference for any announced reduction is the prior price: the lowest price the trader applied in the
period before the reduction (at least 30 days under EU law; the market profile says which period and options
apply). It is often not the last price. Never compute a percentage from the last price, and never compute a
discount or a prior price yourself.

1. Before you write a reduction, call `get-prior-price` with the market profile code (for example `DE` or
   `EU-BASE`), the SKU and the first day of the promotion (YYYY-MM-DD).
   - If `status` is `cannot-verify`, say the price history does not cover the window (or the product is too
     new) and do not write a reduction. Quote `reason`.
2. Call `check-price-claim` with the claim you plan to write: `newPrice`, and `shownPrior` and/or
   `shownPercent` (a promotional label without numbers is `claimType: statement`).
3. Read `verdict`:
   - `ok`: you may use the claim. `labels.en` (and `labels.de`) is a label built from the computed numbers.
   - `fail`: do not use the claim. Each entry in `codes` says why. Rewrite with the computed numbers:
     the prior price `priorPrice`, at most `supportedPercent`, or the price `maxPriceForClaim` that would
     support the percentage that was asked for. Or write the copy without a reduction.
   - `cannot-verify`: do not write a reduction.
4. Quote numbers exactly as returned, with the market profile they came from.
5. You report what the configured rules compute from the stored price history. This is not legal advice;
   send questions beyond the result to the team's reviewer.

Example: a 55-inch TV at 649.00 from 2026-12-05 with "was 799, -18%". `get-prior-price` returns 699.00
(the Cyber Monday price, still inside the window), so `check-price-claim` fails with REFERENCE_OVERSTATED and
PERCENT_OVERSTATED: write "649.00, -7% (lowest price in the last 30 days: 699.00)" or lower the price to
573.18 to keep -18%.
