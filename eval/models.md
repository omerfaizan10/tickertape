# Model comparison

Every model runs the same pipeline, prompts (`v4`) and checks on all 54 golden-set filings. Only the model that picks rows changes. Costs use OpenAI's standard-tier prices, checked 2026-09-28; reasoning tokens are billed as output.

Before/after cutoff splits each model's graded figures by whether the filing was made before or after that model's training cutoff. A model could have seen a filing made before its cutoff during training; it cannot have seen one made after.

| Model | Figure accuracy | Filed before cutoff | Filed after cutoff | Cost / filing | Time / filing | Retried | Cutoff |
|---|---|---|---|---|---|---|---|
| `gpt-6-luna@none` | 544/545 (99.8%) | 99.8% of 494 | 100.0% of 51 | $0.0006 | 2.7s | 0/54 | 2026-05-18 |
| `gpt-4o-mini` | 541/545 (99.3%) | none | 99.3% of 545 | $0.0010 | 3.2s | 16/54 | 2023-10-01 |
| `gpt-6-luna` | 544/545 (99.8%) | 99.8% of 494 | 100.0% of 51 | $0.0007 | 3.4s | 0/54 | 2026-05-18 |
| `gpt-6-sol` | 544/545 (99.8%) | 99.8% of 494 | 100.0% of 51 | $0.0128 | 4.1s | 0/54 | 2026-04-20 |
