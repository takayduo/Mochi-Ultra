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

def send_partner_message(parameters=None, player=None, **kwargs) -> str:
    """
    Sends a direct live chat message to the creator partner (e.g. Ayzil / Her)
    via Mochi's live channel.
    """
    params = parameters or {}
    message_text = params.get("message_text") or params.get("text", "")

    if not message_text or not str(message_text).strip():
        return "Cannot send an empty message."

    clean_text = str(message_text).strip()
    data_dir = _get_coucou_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    settings_file = data_dir / "settings.json"
    chat_file = data_dir / "chat_history.json"

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
            print("[PartnerChat] Error loading settings:", e)

    msg_id = f"msg_{int(time.time() * 1000)}_{os.urandom(3).hex()}"
    new_msg = {
        "id": msg_id,
        "sender": user_name,
        "recipient": partner_name,
        "senderRole": user_role,
        "text": clean_text,
        "timestamp": int(time.time() * 1000),
        "read": True,
        "isAiGenerated": True,
    }

    # Save to local chat_history.json
    history = []
    if chat_file.exists():
        try:
            with open(chat_file, "r", encoding="utf-8") as f:
                history = json.load(f)
                if not isinstance(history, list):
                    history = []
        except Exception:
            history = []

    history.append(new_msg)
    try:
        with open(chat_file, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("[PartnerChat] Error saving chat history:", e)

    # Emit to Electron so it broadcasts via Supabase Realtime in <50ms
    if player and hasattr(player, "emit"):
        try:
            player.emit("partner_chat_send", {
                "text": clean_text,
                "sender": user_name,
                "recipient": partner_name,
                "senderRole": user_role,
                "id": msg_id,
            })
        except Exception as e:
            print("[PartnerChat] Error emitting IPC:", e)

    print(f"[PartnerChat] Sent to {partner_name}: \"{clean_text}\"")
    if player and hasattr(player, "write_log"):
        player.write_log(f"CHAT: Sent to {partner_name}: \"{clean_text}\"")

    return f"Sent to {partner_name}: \"{clean_text}\""


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────
TOOL = {
    "name": "send_partner_message",
    "description": (
        "Sends a direct live chat message to the creator partner (e.g. Ayzil, Her, Badsha) "
        "via Mochi's live couple channel. Use this whenever the user says: "
        "'send a message to her', 'text her', 'tell her...', 'message my partner', etc. "
        "Write 'message_text' in the user's natural language and exact intent."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "message_text": {
                "type": "STRING",
                "description": "The message text to send to the partner",
            }
        },
        "required": [
            "message_text"
        ],
    },
    "handler": send_partner_message,
}
