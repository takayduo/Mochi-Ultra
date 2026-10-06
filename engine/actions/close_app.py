"""
close_app.py — Safely close and terminate desktop applications and games.

Designed to:
1. First check if the application is registered in Application Paths (Settings -> Application Paths).
   If found, extracts the target process/executable from the configured path and terminates it.
2. If not found in Application Paths, attempts to terminate the application by searching
   known game/app process names (e.g. Valorant, League, CS, Discord, Chrome, etc.) and
   scanning active system processes.
3. Strict Safety Protection: NEVER under any circumstances closes Mochi, Coucou, Electron,
   Python runner, or development editors.
"""

from __future__ import annotations

import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

try:
    import psutil
    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

_SYSTEM = platform.system()

# Absolute protection: processes and keywords that MUST NEVER be terminated
_PROTECTED_KEYWORDS = {
    "mochi", "coucou", "ultra", "electron", "python", "pythonw", "py",
    "code", "cursor", "antigravity", "gemini", "jarvis", "system",
    "idle", "explorer.exe", "svchost", "dwm", "csrss", "winlogon",
    "services", "lsass", "smss", "taskhostw"
}

# Popular games & desktop apps mapped to their Windows process executables
_KNOWN_APP_PROCESSES: dict[str, list[str]] = {
    "valorant": [
        "VALORANT.exe",
        "VALORANT-Win64-Shipping.exe",
        "RiotClientServices.exe",
        "RiotClientCrashHandler.exe",
    ],
    "riot": [
        "RiotClientServices.exe",
        "RiotClientCrashHandler.exe",
    ],
    "league of legends": [
        "LeagueClient.exe",
        "League of Legends.exe",
        "LeagueClientUx.exe",
        "LeagueCrashHandler.exe",
    ],
    "league": [
        "LeagueClient.exe",
        "League of Legends.exe",
        "LeagueClientUx.exe",
    ],
    "lol": [
        "LeagueClient.exe",
        "League of Legends.exe",
    ],
    "csgo": ["cs2.exe", "csgo.exe"],
    "cs2": ["cs2.exe", "csgo.exe"],
    "counter-strike": ["cs2.exe", "csgo.exe"],
    "counter strike": ["cs2.exe", "csgo.exe"],
    "roblox": [
        "RobloxPlayerBeta.exe",
        "RobloxPlayer.exe",
        "Roblox.exe",
    ],
    "fortnite": [
        "FortniteClient-Win64-Shipping.exe",
        "FortniteLauncher.exe",
    ],
    "gta": ["GTA5.exe", "PlayGTAV.exe"],
    "gta 5": ["GTA5.exe", "PlayGTAV.exe"],
    "gta v": ["GTA5.exe", "PlayGTAV.exe"],
    "apex": ["r5apex.exe"],
    "apex legends": ["r5apex.exe"],
    "minecraft": ["Minecraft.exe", "javaw.exe"],
    "steam": ["steam.exe", "steamservice.exe", "steamwebhelper.exe"],
    "epic": ["EpicGamesLauncher.exe"],
    "epic games": ["EpicGamesLauncher.exe"],
    "discord": ["Discord.exe"],
    "whatsapp": ["WhatsApp.exe", "WhatsAppDesktop.exe"],
    "obs": ["obs64.exe", "obs32.exe", "obs.exe"],
    "obs studio": ["obs64.exe", "obs32.exe", "obs.exe"],
    "premiere": ["Adobe Premiere Pro.exe"],
    "premiere pro": ["Adobe Premiere Pro.exe"],
    "photoshop": ["Photoshop.exe"],
    "after effects": ["AfterFX.exe"],
    "chrome": ["chrome.exe"],
    "google chrome": ["chrome.exe"],
    "edge": ["msedge.exe"],
    "firefox": ["firefox.exe"],
    "brave": ["brave.exe"],
    "opera": ["opera.exe"],
    "spotify": ["Spotify.exe"],
    "notepad": ["notepad.exe"],
    "telegram": ["Telegram.exe"],
    "slack": ["slack.exe"],
    "zoom": ["Zoom.exe"],
    "vlc": ["vlc.exe"],
    "calculator": ["CalculatorApp.exe", "Calculator.exe", "calc.exe"],
    "calc": ["CalculatorApp.exe", "calc.exe"],
    "paint": ["mspaint.exe", "PaintApp.exe"],
    "blender": ["blender.exe"],
    "postman": ["Postman.exe"],
}


def _get_configured_app_paths() -> dict[str, str]:
    """Load application paths configured in Mochi Settings (settings.json / api_keys.json)."""
    app_paths: dict[str, str] = {}

    # 1. CoucouCreator settings.json
    try:
        settings_file = Path.home() / "AppData" / "Roaming" / "mochi-ultra" / "CoucouCreator" / "settings.json"
        if settings_file.exists():
            data = json.loads(settings_file.read_text(encoding="utf-8"))
            if isinstance(data.get("appPaths"), dict):
                app_paths.update(data["appPaths"])
    except Exception as e:
        print(f"[close_app] Note reading settings.json: {e}")

    # 2. engine/config/api_keys.json
    try:
        base_dir = Path(__file__).resolve().parent.parent
        api_keys_file = base_dir / "config" / "api_keys.json"
        if api_keys_file.exists():
            data = json.loads(api_keys_file.read_text(encoding="utf-8"))
            if isinstance(data.get("app_paths"), dict):
                app_paths.update(data["app_paths"])
    except Exception:
        pass

    return app_paths


def _extract_candidates_from_path(raw_path: str) -> list[str]:
    """Extract candidate process executable names from a configured command or path."""
    candidates: list[str] = []
    clean = (raw_path or "").strip().replace('"', '').replace("'", "")

    # Look for --processStart App.exe (e.g. Discord update wrapper)
    match_start = re.search(r"--processStart\s+([^\s]+\.exe)", raw_path, re.IGNORECASE)
    if match_start:
        candidates.append(match_start.group(1))

    # Look for any .exe names
    exe_matches = re.findall(r"([a-zA-Z0-9_\-\. ]+\.exe)", raw_path, re.IGNORECASE)
    for m in exe_matches:
        base_m = os.path.basename(m.strip())
        if base_m.lower() not in ("explorer.exe", "cmd.exe", "powershell.exe"):
            candidates.append(base_m)

    # Basename of the file itself
    base = os.path.basename(clean)
    if base.lower().endswith((".exe", ".lnk", ".url")):
        stem = re.sub(r"\.(exe|lnk|url)$", "", base, flags=re.IGNORECASE).strip()
        candidates.append(f"{stem}.exe")
        candidates.append(base)

    return list(dict.fromkeys(candidates))


def _is_protected_process(name_or_exe: str) -> bool:
    """Check if process is part of Mochi, Python engine, or protected Windows systems."""
    lower = (name_or_exe or "").lower()
    for kw in _PROTECTED_KEYWORDS:
        if kw in lower:
            return True
    return False


def _kill_candidates(candidates: list[str]) -> int:
    """Attempt to terminate process candidates via psutil and taskkill. Returns number of processes killed."""
    killed_count = 0

    if _HAS_PSUTIL:
        for p in psutil.process_iter(["pid", "name", "exe"]):
            try:
                pname = (p.info["name"] or "").strip().lower()
                pexe = (p.info["exe"] or "").strip().lower()

                # Safety guard: never kill protected processes
                if _is_protected_process(pname) or _is_protected_process(pexe):
                    continue

                for cand in candidates:
                    cand_lower = cand.lower().strip()
                    if pname == cand_lower or pexe.endswith(cand_lower):
                        p.kill()
                        killed_count += 1
                        print(f"[close_app] psutil killed PID {p.info['pid']} ({pname})")
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            except Exception:
                pass

    if _SYSTEM == "Windows":
        for cand in candidates:
            cand_clean = cand.strip().replace('"', '')
            if _is_protected_process(cand_clean):
                continue
            try:
                res = subprocess.run(
                    f'taskkill /IM "{cand_clean}" /F /T',
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if res.returncode == 0 and "SUCCESS" in (res.stdout or ""):
                    killed_count += 1
                    print(f"[close_app] taskkill terminated {cand_clean}")
            except Exception:
                pass

    return killed_count


def _search_and_kill_process_by_query(query: str) -> int:
    """Scan running processes for matches with the query string (excluding protected processes)."""
    killed_count = 0
    query_clean = query.lower().strip().replace(".exe", "")

    if not query_clean or len(query_clean) < 2:
        return 0

    if _is_protected_process(query_clean):
        return 0

    if _HAS_PSUTIL:
        for p in psutil.process_iter(["pid", "name", "exe"]):
            try:
                pname = (p.info["name"] or "").strip().lower()
                pexe = (p.info["exe"] or "").strip().lower()

                if _is_protected_process(pname) or _is_protected_process(pexe):
                    continue

                if query_clean in pname or query_clean in os.path.basename(pexe):
                    p.kill()
                    killed_count += 1
                    print(f"[close_app] psutil search-killed PID {p.info['pid']} ({pname})")
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            except Exception:
                pass

    if _SYSTEM == "Windows" and killed_count == 0:
        try:
            # Safe Stop-Process matching with safety exclusion
            ps_cmd = (
                f"Get-Process | Where-Object {{ ($_.ProcessName -like '*{query_clean}*' -or $_.MainWindowTitle -like '*{query_clean}*') "
                f"-and $_.ProcessName -notmatch 'mochi|coucou|electron|python|code|explorer|system' }} | Stop-Process -Force -ErrorAction SilentlyContinue"
            )
            res = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                timeout=6,
            )
            if res.returncode == 0:
                killed_count += 1
        except Exception:
            pass

    return killed_count


def close_app(
    parameters=None,
    response=None,
    player=None,
    session_memory=None,
    **kwargs,
) -> str:
    """Closes, exits, or terminates an application or game cleanly and safely."""
    raw_name = (parameters or {}).get("app_name", "").strip()

    if not raw_name:
        return "Please specify the name of the application you want me to close."

    query = raw_name.lower().strip().replace('"', '').replace("'", "")

    # Safety Guard: Check if the user is asking to close Mochi or Coucou
    if _is_protected_process(query):
        return (
            "I cannot close myself or the active Mochi system. "
            "If you'd like me out of the way, you can say 'hide' or 'sleep' and I will collapse quietly into the top bar."
        )

    print(f"[close_app] User requested closing: '{raw_name}'")
    if player:
        player.write_log(f"[close_app] Closing {raw_name}")

    # ─────────────────────────────────────────────────────────────────────────────
    # STEP 1: Check if configured in Application Paths
    # ─────────────────────────────────────────────────────────────────────────────
    app_paths = _get_configured_app_paths()
    configured_match_key = None
    configured_match_val = None

    for key, val in app_paths.items():
        k_lower = key.lower().strip()
        if k_lower == query or query in k_lower or k_lower in query:
            configured_match_key = key
            configured_match_val = val
            break

    if configured_match_val:
        print(f"[close_app] Match found in Application Paths: '{configured_match_key}' -> '{configured_match_val}'")
        candidates = _extract_candidates_from_path(configured_match_val)
        # Also include any known aliases for the key
        if configured_match_key.lower() in _KNOWN_APP_PROCESSES:
            candidates.extend(_KNOWN_APP_PROCESSES[configured_match_key.lower()])

        killed = _kill_candidates(candidates)
        if killed > 0:
            return f"Closed {configured_match_key} from your configured Application Paths."

    # ─────────────────────────────────────────────────────────────────────────────
    # STEP 2: If not in Application Paths (or wasn't running), try to close the app itself
    # ─────────────────────────────────────────────────────────────────────────────
    # Check known games & desktop applications
    candidates = []
    for app_alias, procs in _KNOWN_APP_PROCESSES.items():
        if app_alias == query or query in app_alias or app_alias in query:
            candidates.extend(procs)

    if not candidates:
        clean_stem = query.replace(".exe", "").strip()
        candidates = [f"{clean_stem}.exe", query]

    killed = _kill_candidates(candidates)
    if killed > 0:
        return f"Closed {raw_name}."

    # Step 3: Dynamic running process lookup
    killed = _search_and_kill_process_by_query(query)
    if killed > 0:
        return f"Closed {raw_name}."

    return (
        f"I couldn't find a running process for '{raw_name}'. "
        f"It might already be closed, or you can add its path under Application Paths in Settings."
    )


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────
TOOL = {
    "name": "close_app",
    "description": (
        "Closes, exits, terminates, or kills an application or game on the computer. "
        "Use this whenever the user asks to close, exit, quit, kill, or stop any app or game (e.g. 'close Valorant', 'exit Discord', 'close OBS', 'quit Premiere', 'close WhatsApp'). "
        "First checks configured Application Paths, then locates and terminates the app's process cleanly. "
        "Never use Alt+F4 directly."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "app_name": {
                "type": "STRING",
                "description": "Exact name or title of the application or game to close (e.g. 'Valorant', 'Discord', 'OBS', 'WhatsApp', 'Premiere', 'Notepad')",
            }
        },
        "required": ["app_name"],
    },
    "handler": close_app,
}
