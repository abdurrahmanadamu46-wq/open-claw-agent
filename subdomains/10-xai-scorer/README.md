# XAI Scorer

Thread: `sd-10`

Existing source anchor:

- [services/xai-scorer-service/README.md](/F:/openclaw-agent/services/xai-scorer-service/README.md)

## 1. Boundary & Contract

Protocol:

- Lead scoring: REST

Input example:

```json
{
  "schema_version": "xai.score.request.v1",
  "tenant_id": "tenant_demo",
  "lead": {
    "content": "How much? Where can I buy?",
    "interaction_depth": 3,
    "persona_tag": "hot_buy_intent"
  }
}
```

Output example:

```json
{
  "schema_version": "xai.score.result.v1",
  "status": "success",
  "score": 86,
  "grade": "A",
  "explanation": {
    "top_factors": ["buy_intent", "direct_price_question"],
    "counterfactual": "Add contact detail to increase close probability."
  }
}
```

## 2. Core Responsibilities

- Score leads
- Explain why they were scored that way
- Offer counterfactual rescue suggestions

## 3. Fallback & Mock

- If unavailable, return rule-based fallback score
- Parent system may continue with conservative lead tiering

## 4. Independent Storage & Dependencies

- Dedicated scoring history DB
- Optional feature store

## 5. Evolution Path

- Rules
- Tree models
- Local explainable model
