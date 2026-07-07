# NovaSupport Ops Copilot 🤖

An **MCP-powered agent** built for **Challenge 5** — an interactive support copilot
that reasons over NovaSupport's ticket & knowledge-base data.

## How it meets the rules
| Rule | How |
|------|-----|
| Strands Agents SDK | `Agent(...)` in `copilot.py` |
| At least one MCP server | Official **filesystem MCP server** (`@modelcontextprotocol/server-filesystem`) |
| Amazon Nova Pro (Bedrock) | `BedrockModel(model_id="amazon.nova-pro-v1:0")` |
| Interactive chat loop | `while True: input("You > ")` terminal loop |
| Own idea | A support-ops copilot grounded in NovaSupport's own data |

## What it does
Chat in your terminal to:
- summarize past tickets and how they were resolved,
- find how similar issues were handled before,
- draft customer replies,
- ask questions about the support knowledge base.

The agent reads files from the `data/` folder through the filesystem MCP server.

## Prerequisites
- **Python 3.10+**
- **Node.js** (the MCP server runs via `npx`)
- **AWS credentials** with Bedrock access to `amazon.nova-pro-v1:0` (region `us-east-1` by default)

## Setup & Run
```bash
cd support-copilot
pip install -r requirements.txt

# (optional) add real exported tickets / KB files into ./data
python copilot.py
```

Then chat:
```
You > how were past password reset issues solved?
Copilot > ...
You > exit
```

## Configuration (optional env vars)
- `AWS_REGION` — Bedrock region (default `us-east-1`)
- `NOVA_MODEL_ID` — model id (default `amazon.nova-pro-v1:0`)
- `COPILOT_DATA_DIR` — folder the agent may read (default `./data`)

## Tip: use real NovaSupport data
Export resolved tickets to Markdown/JSON into `data/` (e.g. from DynamoDB) so the
copilot answers from your actual support history instead of the sample file.
