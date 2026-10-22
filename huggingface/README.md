---
language:
  - en
license: other
license_name: qwen
license_link: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/main/LICENSE
library_name: transformers
tags:
  - outdoor-activity
  - recommendation
  - weather
  - geospatial
  - grounded
  - qwen
  - SLM
base_model: Qwen/Qwen2.5-1.5B-Instruct
base_model_relation: fine-tuned
inference: false
---

# OutdoorPal — Qwen2.5-1.5B-Instruct (Grounded Outdoor Activity Assistant)

## Model description

This repository points to **`Qwen/Qwen2.5-1.5B-Instruct`** (1.54 B parameters, open Qwen license) as the language model used inside **OutdoorPal**, an outdoor-activity recommendation assistant built for the GeoAI Hackathon @ CSRE, IIT Bombay.

The model is used **as-is** (no fine-tuning). The hackathon explicitly allows this: *"You may use an open base model directly (for example Phi-3-mini, Llama-3.2, Qwen2.5 or Gemma-2)."* We register it on the Hub to make the model identity, parameter count, license and invocation method unambiguous.

## Parameter count

| Model | Parameters | Within ≤3 B cap? |
|---|---|---|
| Qwen2.5-1.5B-Instruct | **1.54 B** | ✓ Yes |

## Role in the assistant

The SLM is used **only** for natural-language generation (NLG) — turning the structured reasoning output of the rule engine into friendly prose. It is **constrained**:

- **System prompt** forbids it from inventing weather, places, times, or numbers — only facts supplied in the user message are allowed.
- **Input** is a structured payload (origin, top-3 venue-hour-score triples, weather summary, blockers, reasons, advice) built deterministically by the reasoner from live Open-Meteo / OSM data.
- **Output** is constrained to ≤350 new tokens, temperature 0.4, top-p 0.85, with a deterministic `### Sources` block appended afterwards so citations are never lost.
- If the SLM call fails for any reason (network, rate limit), the assistant falls back to a **deterministic template generator** that is also grounded in the live data. Either way, no answer is produced from the SLM's parametric memory.

## Intended use

- **Primary:** Recommend outdoor activity venues and times based on live weather + geospatial data, with practical advice (carry / watch / avoid).
- **Out-of-scope:** This model alone is *not* a weather oracle; it cannot be queried for live data. It should not be used for medical or safety-critical decisions; consult local authorities and forecasts for that.

## How to load

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-1.5B-Instruct", torch_dtype="auto")
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-1.5B-Instruct")

messages = [
    {"role": "system", "content": "You are an outdoor-activity assistant. Use ONLY the facts provided in the user message."},
    {"role": "user", "content": "..."},
]
text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer([text], return_tensors="pt").to(model.device)
out = model.generate(**inputs, max_new_tokens=350, temperature=0.4, top_p=0.85, do_sample=True)
print(tokenizer.decode(out[0], skip_special_tokens=True))
```

Inside the assistant we call it via the Hugging Face **Inference API**:

```python
import requests
r = requests.post(
    "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-1.5B-Instruct",
    headers={"Authorization": f"Bearer {HF_TOKEN}"},
    json={
        "inputs": "<|im_start|>system\n{sys}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n",
        "parameters": {"max_new_tokens": 350, "temperature": 0.4, "top_p": 0.85, "return_full_text": False, "stop": ["<|im_end|>"]},
        "options": {"wait_for_model": True, "use_cache": True},
    },
)
```

Self-hosting with `text-generation-inference` or `vLLM` is a drop-in alternative — set `HF_MODEL` to your endpoint.

## Training data

We did **not** train or fine-tune the model. The base instruct checkpoint from the Qwen team is used directly. The Qwen team's training data is documented in the upstream model card at <https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct>.

If a future iteration fine-tunes the model on grounded QA pairs (question → reasoning output → recommendation prose), the LoRA adapter will be published in this repository together with the exact base model commit hash. Training data and methodology will be documented here at that point.

## Evaluation

End-to-end evaluation of the assistant is qualitative: a sample of free-form questions is run through the live pipeline and the recommendations are checked for (a) groundedness — every numeric claim traceable to a live API response; (b) usefulness — the top-ranked venue × hour slot is reasonable given current conditions; (c) honest failure — when no slot passes the activity's safety limits, the assistant says so rather than hallucinating.

The structured `reasoner` JSON returned by `/api/assistant` exposes the full scoring breakdown, so each recommendation can be audited by the user/judge.

## Bias & risks

OSM coverage is uneven across India — smaller towns have fewer tagged parks, pitches and trails than metro cities. The assistant compensates by falling back to Nominatim POI search when Overpass returns nothing, but a user in a poorly-mapped area may receive "no venue found" more often than a user in Pune or Bengaluru. This is data coverage bias, not model bias.

The activity thresholds (e.g. AQI ≤ 50 for running) are reasonable starting points, not medical guidance. They are tightened further for asthma / senior / child / pregnancy profiles, but users with specific medical conditions should consult their doctor.

## Environmental impact

Inference of a 1.5 B model for a single query emits well under 1 g CO₂eq (a few hundred tokens generated). For comparison, GPT-4 class systems are several orders of magnitude heavier per query.

## Citation

If you use this work, please cite both the Qwen base model and this repository:

```bibtex
@misc{qwen25,
  title={Qwen2.5 Technical Report},
  author={Qwen Team},
  year={2024},
  url={https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct}
}

@misc{outdoorpal2026,
  title={OutdoorPal: a grounded outdoor-activity recommendation assistant},
  author={GeoAI Hackathon Team},
  year={2026},
  note={Built for the GeoAI Hackathon @ CSRE, IIT Bombay}
}
```

## License

The Qwen license applies to the model weights. See <https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/main/LICENSE>.

Our pipeline code is MIT-licensed.

## Contact

Open an issue on the code repository, or contact the team via the hackathon submission form.
