import json
import os
import time
from pathlib import Path

def _get_coucou_data_dir() -> Path:
    appdata = os.environ.get("APPDATA", "")
    candidates = [
        Path(appdata) / "mochi-ultra" / "CoucouCreator",
        Path(appdata) / "CoucouCreator",
        Path(appdata) / "Mochi-Ultra" / "CoucouCreator",
        Path(appdata) / "mochi" / "CoucouCreator",
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]

def manage_schedule(parameters=None, player=None, **kwargs) -> str:
    """
    Manages the daily shared creator couple schedule and tasks for both users.
    Supports adding tasks for 'me', 'her', or 'both', marking tasks completed,
    or listing all current tasks.
    """
    params = parameters or {}
    act = (params.get("action") or "list").strip().lower()
    title = params.get("title", "")
    time_str = params.get("time_str") or params.get("time", "")
    for_who = params.get("for_who") or params.get("for", "me")

    data_dir = _get_coucou_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    settings_file = data_dir / "settings.json"
    schedule_file = data_dir / "schedule.json"

    user_name = "Badsha"
    partner_name = "Ayzil"
    user_role = "me"
    partner_role = "her"

    if settings_file.exists():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                s = json.load(f)
                user_name = s.get("userName") or "Badsha"
                partner_name = s.get("partnerName") or "Ayzil"
                user_role = s.get("userRole") or "me"
                partner_role = "her" if user_role == "me" else "me"
        except Exception as e:
            print("[Schedule] Error loading settings:", e)

    # Load schedule
    tasks = []
    if schedule_file.exists():
        try:
            with open(schedule_file, "r", encoding="utf-8") as f:
                tasks = json.load(f)
                if not isinstance(tasks, list):
                    tasks = []
        except Exception:
            tasks = []

    # 1. ACTION: ADD TASK
    if act in ("add", "create", "new"):
        clean_title = (title or "").strip()
        if not clean_title:
            return "Please provide a task title to add to the schedule."

        target_who = (for_who or "me").strip().lower()
        if any(w in target_who for w in ("her", "partner", "she", partner_name.lower())):
            assignee = partner_role
            assignee_display = partner_name
        elif any(w in target_who for w in ("both", "all", "us", "together")):
            assignee = "both"
            assignee_display = f"{user_name} & {partner_name}"
        else:
            assignee = user_role
            assignee_display = user_name

        new_item = {
            "id": f"task_{int(time.time() * 1000)}_{os.urandom(3).hex()}",
            "title": clean_title,
            "time": (time_str or "").strip(),
            "assignee": assignee,
            "assignedBy": user_role,
            "completed": False,
            "createdAt": int(time.time() * 1000),
        }

        tasks.append(new_item)
        try:
            with open(schedule_file, "w", encoding="utf-8") as f:
                json.dump(tasks, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print("[Schedule] Error saving schedule file:", e)

        if player and hasattr(player, "emit"):
            try:
                player.emit("schedule_add", {"item": new_item})
            except Exception as e:
                print("[Schedule] Error emitting IPC:", e)

        time_part = f" at {time_str}" if time_str else ""
        msg = f"Added task for {assignee_display}: \"{clean_title}\"{time_part}"
        print(f"[Schedule] {msg}")
        if player and hasattr(player, "write_log"):
            player.write_log(f"SYS: {msg}")
        return msg

    # 2. ACTION: COMPLETE / MARK DONE
    elif act in ("complete", "done", "finish", "toggle"):
        clean_title = (title or "").strip().lower()
        if not clean_title:
            return "Please specify which task to mark as completed."

        matched = None
        for t in tasks:
            if clean_title in t.get("title", "").lower() or clean_title == t.get("id", "").lower():
                matched = t
                break

        if not matched:
            return f"Could not find a task matching \"{title}\"."

        matched["completed"] = True
        matched["completedAt"] = int(time.time() * 1000)

        try:
            with open(schedule_file, "w", encoding="utf-8") as f:
                json.dump(tasks, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print("[Schedule] Error saving schedule file:", e)

        if player and hasattr(player, "emit"):
            try:
                player.emit("schedule_toggle", {"id": matched["id"], "title": matched["title"]})
            except Exception as e:
                print("[Schedule] Error emitting IPC:", e)

        msg = f"Marked task \"{matched.get('title')}\" as completed!"
        print(f"[Schedule] {msg}")
        if player and hasattr(player, "write_log"):
            player.write_log(f"SYS: {msg}")
        return msg

    # 3. ACTION: LIST TASKS
    else:
        if not tasks:
            return "There are no tasks scheduled on the calendar right now."

        my_tasks = [t for t in tasks if t.get("assignee") in (user_role, "both")]
        partner_tasks = [t for t in tasks if t.get("assignee") in (partner_role, "both")]

        lines = ["Today's Schedule:"]
        lines.append(f"\n{user_name}'s Tasks:")
        if my_tasks:
            for t in my_tasks:
                status = "DONE" if t.get("completed") else "PENDING"
                t_lbl = f" [{t.get('time')}]" if t.get("time") else ""
                lines.append(f"  • [{status}]{t_lbl} {t.get('title')}")
        else:
            lines.append("  (No tasks)")

        lines.append(f"\n{partner_name}'s Tasks:")
        if partner_tasks:
            for t in partner_tasks:
                status = "DONE" if t.get("completed") else "PENDING"
                t_lbl = f" [{t.get('time')}]" if t.get("time") else ""
                lines.append(f"  • [{status}]{t_lbl} {t.get('title')}")
        else:
            lines.append("  (No tasks)")

        res_text = "\n".join(lines)
        if player and hasattr(player, "show_content"):
            player.show_content(f"SCHEDULE — {user_name} & {partner_name}", res_text)
        return res_text


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────
TOOL = {
    "name": "manage_schedule",
    "description": (
        "Manages the shared daily creator couple schedule and tasks for both users. "
        "Supports adding tasks for 'me', 'her', or 'both', marking tasks completed, "
        "and listing today's schedule. Use when the user says: "
        "'add a task for her/me/both', 'schedule review for 3 PM', 'what are my tasks', "
        "'what does she have to do', 'mark thumbnail as done', etc."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "'add' to create a task, 'complete' to mark done, 'list' to view tasks. Default: 'list'",
            },
            "title": {
                "type": "STRING",
                "description": "The task title / description",
            },
            "time_str": {
                "type": "STRING",
                "description": "Optional scheduled time (e.g. '11:00 AM', '03:30 PM', 'today')",
            },
            "for_who": {
                "type": "STRING",
                "description": "Who the task is for: 'me', 'her', or 'both'. Default: 'me'",
            },
        },
        "required": [
            "action"
        ],
    },
    "handler": manage_schedule,
}
