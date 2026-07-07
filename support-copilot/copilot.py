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

Design note — why local tool wrappers:
  Nova Pro is unreliable at *constructing* filesystem paths for the raw MCP
  tools (it keeps asking the user "what's the path?"). To make the agent
  deterministic, we expose a few dead-simple tools that take a TEAM NAME
  (never a path). Each wrapper still performs the actual file access through
  the filesystem MCP server via mcp_client.call_tool_sync(...), so the MCP
  server is genuinely doing the work — we just give Nova a foolproof interface.

Run:
    pip install -r requirements.txt
    # requires Node.js (for the MCP server via npx) and AWS creds with
    # Bedrock access to amazon.nova-pro-v1:0
    python copilot.py
"""

import os
import re
import sys
import uuid

from strands import Agent, tool
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
knowledge-base articles and then:
  - summarizing tickets and past resolutions,
  - finding how similar issues were solved before,
  - drafting clear, empathetic replies to customers,
  - answering questions about the support knowledge base.

You have these tools (all read-only):
  - list_teams()                     -> which teams have tickets
  - list_team_tickets(team)          -> filenames for one team
  - read_team_tickets(team)          -> full text of EVERY ticket for a team
  - read_ticket(team, filename)      -> one ticket's full text
  - read_knowledge_base()            -> the knowledge-base article
  - search_tickets(query)            -> find tickets mentioning a keyword

Valid team names: auth-team, billing-team, infrastructure-team,
networking-team, technical-team, unassigned.

IMPORTANT RULES:
- NEVER ask the user for a file path. You do not need paths — the tools take a
  plain team name like "auth-team".
- To summarize or analyze a team's tickets, call read_team_tickets(team) ONCE,
  then write the summary from what it returns.
- Always ground answers in tool output. If a team has no tickets, say so.
- Keep replies concise and professional.
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


def _mcp_text(result) -> str:
    """Extract plain text from an MCPToolResult (or dict-like) result."""
    content = getattr(result, "content", None)
    if content is None and isinstance(result, dict):
        content = result.get("content")
    parts = []
    for block in content or []:
        if isinstance(block, dict):
            t = block.get("text")
        else:
            t = getattr(block, "text", None)
        if t:
            parts.append(str(t))
    return "\n".join(parts) if parts else str(result)


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

        def _call(name: str, arguments: dict) -> str:
            """Invoke a filesystem MCP tool and return its text output."""
            result = mcp_client.call_tool_sync(str(uuid.uuid4()), name, arguments)
            return _mcp_text(result)

        # ---- Local tools: simple team-name interface, MCP does the work ----

        @tool
        def list_teams() -> str:
            """List the support teams (folders) that have tickets."""
            return _call("list_directory", {"path": "tickets"})

        @tool
        def list_team_tickets(team: str) -> str:
            """List the ticket filenames for one team (e.g. team='auth-team')."""
            return _call("list_directory", {"path": f"tickets/{team}"})

        @tool
        def read_team_tickets(team: str) -> str:
            """Read the full text of EVERY ticket for a team at once.

            Best tool for summarizing or analyzing a whole team. Pass a plain
            team name like 'auth-team' or 'billing-team'.
            """
            listing = _call("list_directory", {"path": f"tickets/{team}"})
            files = re.findall(r"([A-Za-z0-9._-]+\.md)", listing)
            if not files:
                return f"No tickets found for team '{team}'."
            chunks = []
            for fname in files:
                body = _call("read_text_file", {"path": f"tickets/{team}/{fname}"})
                chunks.append(f"===== {fname} =====\n{body}")
            return "\n\n".join(chunks)

        @tool
        def read_ticket(team: str, filename: str) -> str:
            """Read one ticket's full text (team='auth-team', filename='TKT-....md')."""
            return _call("read_text_file", {"path": f"tickets/{team}/{filename}"})

        @tool
        def read_knowledge_base() -> str:
            """Read the support knowledge-base article."""
            return _call("read_text_file", {"path": "knowledge-base.md"})

        @tool
        def search_tickets(query: str) -> str:
            """Find ticket files whose content or name matches a keyword."""
            return _call("search_files", {"path": ".", "pattern": query})

        local_tools = [
            list_teams,
            list_team_tickets,
            read_team_tickets,
            read_ticket,
            read_knowledge_base,
            search_tickets,
        ]

        agent = Agent(
            model=bedrock_model,
            tools=local_tools,
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
