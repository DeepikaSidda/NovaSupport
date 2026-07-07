"""
NovaSupport Ops Copilot — Challenge 5 (MCP-Powered Agent)

An interactive, agentic support copilot built on the Strands Agents SDK.
It uses Amazon Nova Pro (via Amazon Bedrock) to reason, and connects to a
Model Context Protocol (MCP) server (the filesystem server) so it can read
NovaSupport's ticket and knowledge-base data to answer questions, summarize
issues, and draft replies — all through an interactive chat loop.

Satisfies Challenge 5 rules:
  * Uses the Strands Agents SDK                     -> Agent(...)
  * Uses at least one MCP server                    -> filesystem MCP server
  * Uses Amazon Nova Pro on Bedrock                 -> BedrockModel(model_id=...)
  * Has an interactive chat loop                    -> while True: input()
  * Original idea built on NovaSupport's own data

Run:
    pip install -r requirements.txt
    # requires Node.js (for the MCP server via npx) and AWS creds with
    # Bedrock access to amazon.nova-pro-v1:0
    python copilot.py
"""

import os
import re
import sys

from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp import StdioServerParameters, stdio_client

# ---- Configuration ---------------------------------------------------------

# Amazon Nova Pro on Bedrock (change region if needed).
REGION = os.getenv("AWS_REGION", "us-east-1")
MODEL_ID = os.getenv("NOVA_MODEL_ID", "amazon.nova-pro-v1:0")

# Folder the copilot is allowed to read via the filesystem MCP server.
# Point this at exported NovaSupport tickets / knowledge-base files.
DATA_DIR = os.getenv(
    "COPILOT_DATA_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"),
)

SYSTEM_PROMPT = """You are the NovaSupport Ops Copilot, an AI assistant for a
customer-support team. You help support agents by reading past tickets and
knowledge-base articles (available through your file tools) and then:
  - summarizing tickets and past resolutions,
  - finding how similar issues were solved before,
  - drafting clear, empathetic replies to customers,
  - answering questions about the support knowledge base.

Always ground your answers in the files you can read. If you don't find
relevant information, say so honestly instead of guessing. Keep replies concise
and professional.
"""


def build_mcp_client() -> MCPClient:
    """Create an MCP client backed by the official filesystem MCP server.

    The server is launched via `npx` (Node.js required) and is scoped to the
    DATA_DIR folder, so the agent can only read files inside it.
    """
    return MCPClient(
        lambda: stdio_client(
            StdioServerParameters(
                command="npx",
                args=["-y", "@modelcontextprotocol/server-filesystem", DATA_DIR],
            )
        )
    )


def main() -> None:
    if not os.path.isdir(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)

    print("=" * 60)
    print(" NovaSupport Ops Copilot  (Strands + Nova Pro + MCP)")
    print("=" * 60)
    print(f" Model : {MODEL_ID}  (region: {REGION})")
    print(f" Data  : {DATA_DIR}")
    print(" Type 'exit' or 'quit' to leave.\n")

    bedrock_model = BedrockModel(model_id=MODEL_ID, region_name=REGION)
    mcp_client = build_mcp_client()

    # The MCP server connection must stay open while the agent uses its tools.
    with mcp_client:
        tools = mcp_client.list_tools_sync()
        agent = Agent(
            model=bedrock_model,
            tools=tools,
            system_prompt=SYSTEM_PROMPT,
            # Disable the default streaming printer so we control the output
            # (prevents the reply being printed twice).
            callback_handler=None,
        )

        # ---- Interactive chat loop ----
        while True:
            try:
                user_input = input("You > ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nGoodbye!")
                break

            if not user_input:
                continue
            if user_input.lower() in {"exit", "quit"}:
                print("Goodbye!")
                break

            try:
                response = agent(user_input)
                # Strip the model's internal <thinking>...</thinking> reasoning
                # so only the clean answer is shown to the user.
                text = re.sub(
                    r"<thinking>.*?</thinking>", "", str(response), flags=re.DOTALL
                ).strip()
                print(f"\nCopilot > {text}\n")
            except Exception as err:  # keep the loop alive on errors
                print(f"\n[error] {err}\n", file=sys.stderr)


if __name__ == "__main__":
    main()
