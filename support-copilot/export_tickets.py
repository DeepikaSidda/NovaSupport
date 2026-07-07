"""
Export NovaSupport tickets from DynamoDB into the copilot's data/ folder.

Each ticket METADATA item is written as a Markdown file the Ops Copilot can
read through the filesystem MCP server. Run this once (or whenever you want to
refresh) so the copilot answers from your real support history.

Usage:
    # requires AWS credentials with read access to the tickets table
    python export_tickets.py

Optional env:
    TICKETS_TABLE_NAME   DynamoDB table (default: the deployed NovaSupport table)
    AWS_REGION           default: us-east-1
"""

import os
import re
import boto3

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE = os.getenv(
    "TICKETS_TABLE_NAME",
    "NovaSupportStack-TicketsTableB76A19AF-YI6Y347YGV92",
)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
TICKETS_DIR = os.path.join(DATA_DIR, "tickets")


def slug(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", text)[:80]


def field(item: dict, key: str, default: str = "") -> str:
    val = item.get(key, default)
    return str(val) if val is not None else default


def main() -> None:
    os.makedirs(TICKETS_DIR, exist_ok=True)
    ddb = boto3.resource("dynamodb", region_name=REGION)
    table = ddb.Table(TABLE)

    print(f"Scanning table {TABLE} in {REGION} ...")
    items = []
    kwargs = {}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek

    written = 0
    for item in items:
        # Only export ticket metadata rows.
        if item.get("SK") != "METADATA":
            continue
        ticket_id = field(item, "ticketId") or field(item, "PK").replace("TICKET#", "")
        if not ticket_id:
            continue

        subject = field(item, "subject", "(no subject)")
        description = field(item, "description")
        status = field(item, "status")
        priority = field(item, "priority")
        category = field(item, "category")
        team = field(item, "assignedTeam")
        assigned_to = field(item, "assignedTo")
        resolution = field(item, "resolution") or field(item, "resolutionSummary")
        created = field(item, "createdAt")

        team_folder = slug(team) if team else "unassigned"

        md = f"""# Ticket {ticket_id}

- Subject: {subject}
- Status: {status}
- Priority: {priority}
- Category: {category}
- Assigned team: {team}
- Assigned to: {assigned_to}
- Created: {created}

## Description
{description}

## Resolution
{resolution or "(not resolved yet)"}
"""
        # Organize by team so the copilot can find "auth-team tickets" etc.
        # simply by listing the team's folder.
        team_dir = os.path.join(TICKETS_DIR, team_folder)
        os.makedirs(team_dir, exist_ok=True)
        path = os.path.join(team_dir, f"{slug(ticket_id)}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(md)
        written += 1

    print(f"Exported {written} tickets to {TICKETS_DIR}")


if __name__ == "__main__":
    main()
