---
name: price-claims
description: Answer questions about announced price reductions with Struck's computed prior price and verdicts instead of computing discounts yourself.
---

# Price claims

1. For any announced reduction (a percentage, a struck-through "was" price or a promotional label), call `get-prior-price` or `check-price-claim` first.
2. Never compute a percentage from the last price. The reference is the prior price Struck returns.
3. If Struck returns CANNOT_VERIFY, say the price history does not cover the window and do not suggest publishing.
4. If someone wants a bigger discount, quote `maxPriceForClaim` from the result.
5. Quote numbers exactly as returned, with the rule profile and source Struck names. You report what the configured rules compute; you do not give legal advice.
