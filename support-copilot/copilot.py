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

Your allowed root directory contains:
  - knowledge-base.md
  - tickets/            (one subfolder per team, one .md file per ticket)
      tickets/auth-team/
      tickets/billing-team/
      tickets/infrastructure-team/
      tickets/networking-team/
      tickets/technical-team/
      tickets/unassigned/

IMPORTANT RULES:
- You already know the layout above. NEVER ask the user for a file path.
- Always USE YOUR TOOLS to answer. Do not ask clarifying questions about paths.
- For a team question (e.g. "auth-team tickets"), immediately call
  list_directory on "tickets/auth-team", then read_text_file on each ticket
  file (a few at a time) and summarize.
- If a folder is empty or missing, say so honestly.
- Ground every answer in the files you read. Keep replies concise and professional.
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

    # streaming=False avoids Nova's "invalid sequence as part of ToolUse"
    # streaming error; the non-streaming Converse API handles tool use reliably.
    bedrock_model = BedrockModel(
        model_id=MODEL_ID, region_name=REGION, streaming=False
    )
    mcp_client = build_mcp_client()

    # The MCP server connection must stay open while the agent uses its tools.
    with mcp_client:
        all_tools = mcp_client.list_tools_sync()

        # Nova Pro can emit malformed tool-use sequences with the filesystem
        # server's more complex tools (read_multiple_files, directory_tree,
        # write/edit tools). Restrict the agent to a small, simple, READ-ONLY
        # subset for reliable tool use.
        allowed = {
            "read_text_file",
            "read_file",
            "list_directory",
            "search_files",
            "get_file_info",
            "list_allowed_directories",
        }

        def tool_name(t) -> str:
            for attr in ("tool_name", "name"):
                n = getattr(t, attr, None)
                if isinstance(n, str):
                    return n
            spec = getattr(t, "tool_spec", None)
            if isinstance(spec, dict):
                return str(spec.get("name", ""))
            return ""

        tools = [t for t in all_tools if tool_name(t) in allowed] or all_tools

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

            # Retry once on Nova's occasional malformed tool-use error.
            response = None
            last_err = None
            for attempt in range(2):
                try:
                    response = agent(user_input)
                    break
                except Exception as err:
                    last_err = err

            if response is None:
                print(f"\n[error] {last_err}\n", file=sys.stderr)
                continue

            # Strip the model's internal <thinking>...</thinking> reasoning
            # so only the clean answer is shown to the user.
            text = re.sub(
                r"<thinking>.*?</thinking>", "", str(response), flags=re.DOTALL
            ).strip()
            print(f"\nCopilot > {text}\n")


if __name__ == "__main__":
    main()
