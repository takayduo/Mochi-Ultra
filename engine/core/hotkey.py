"""
Push-to-talk — hold a key, speak, release.

Why this exists
---------------
Wake-word is hands-free but it is not always what you want: in a meeting, in a
noisy room, or when you simply do not feel like saying a name out loud, a key
you hold is faster and never mishears. It is also the natural way to use the
assistant while another window has focus.

How it works, and what it costs
-------------------------------
Zero new dependencies, best available mechanism per platform:

* **Windows** — `GetAsyncKeyState` polled from one small thread. This is
  deliberately *not* `RegisterHotKey`, which only reports a press: push-to-talk
  needs the release too, and it needs to work while another application has
  focus. Polling two virtual-key codes 30 times a second is a rounding error of
  CPU and needs no message loop.
* **macOS / Linux** — no portable way to read global key state without pulling
  in a new package or asking for accessibility permissions, so the chord is
  bound as an application shortcut instead: it works whenever the assistant's
  window has focus. `scope` reports which of the two you got, so the UI can say
  so honestly rather than pretending.

The class never raises. If the platform hook cannot be installed it simply
reports `scope == "window"` and the Qt shortcut carries it.
"""

from __future__ import annotations

import platform
import threading
import time
from typing import Callable

_OS = platform.system()

# The default chord. Ctrl+Space is free in most desktop environments and is the
# same finger shape on every keyboard layout, which matters for a worldwide app.
DEFAULT_CHORD = ("ctrl", "space")

# Windows virtual-key codes for the names we accept.
_VK = {
    "ctrl": 0x11, "control": 0x11, "lctrl": 0xA2, "rctrl": 0xA3,
    "shift": 0x10, "lshift": 0xA0, "rshift": 0xA1,
    "alt": 0x12, "lalt": 0xA4, "ralt": 0xA5,
    "space": 0x20, "spacebar": 0x20,
    "capslock": 0x14, "caps": 0x14,
    "tilde": 0xC0, "`": 0xC0, "grave": 0xC0, "backquote": 0xC0,
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73, "f5": 0x74, "f6": 0x75,
    "f7": 0x76, "f8": 0x77, "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
    "insert": 0x2D, "tab": 0x09, "pause": 0x13,
}

# Qt key sequence text for the same chord, used by the windowed fallback.
_QT_NAME = {
    "ctrl": "Ctrl", "control": "Ctrl", "lctrl": "Left Ctrl", "rctrl": "Right Ctrl",
    "shift": "Shift", "lshift": "Left Shift", "rshift": "Right Shift",
    "alt": "Alt", "lalt": "Left Alt", "ralt": "Right Alt",
    "space": "Space", "spacebar": "Space",
    "capslock": "CapsLock", "caps": "CapsLock",
    "tilde": "~", "`": "`", "grave": "`", "backquote": "`",
    "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4", "f5": "F5", "f6": "F6",
    "f7": "F7", "f8": "F8", "f9": "F9", "f10": "F10", "f11": "F11", "f12": "F12",
    "insert": "Ins", "tab": "Tab", "pause": "Pause",
}

_POLL_HZ = 50.0
_DEBOUNCE_S = 0.02


def parse_chord(chord_val=DEFAULT_CHORD) -> tuple[str, ...]:
    """Parse chord input from string, list, or tuple into canonical key tuple."""
    if isinstance(chord_val, (tuple, list)):
        parts = [str(k).strip().lower() for k in chord_val if str(k).strip()]
        return tuple(parts) if parts else DEFAULT_CHORD
    if isinstance(chord_val, str):
        cleaned = chord_val.replace("+", " ").replace("-", " ")
        parts = [p.strip().lower() for p in cleaned.split() if p.strip()]
        return tuple(parts) if parts else DEFAULT_CHORD
    return DEFAULT_CHORD


def chord_label(chord=DEFAULT_CHORD) -> str:
    """Human-readable name of the chord, for the UI and the logs."""
    parsed = parse_chord(chord)
    return "+".join(_QT_NAME.get(k, k.upper() if len(k) <= 3 else k.title()) for k in parsed)


def qt_sequence(chord=DEFAULT_CHORD) -> str:
    """The same chord as a QKeySequence string."""
    parsed = parse_chord(chord)
    return "+".join(_QT_NAME.get(k, k.upper() if len(k) <= 3 else k.title()) for k in parsed)


class PushToTalk:
    """Calls `on_change(held: bool)` whenever the chord is pressed or released.

    Start it once; it is safe to start and stop repeatedly, and safe to stop a
    detector that never started.
    """

    def __init__(self, on_change: Callable[[bool], None], chord=DEFAULT_CHORD):
        self._on_change = on_change
        self._chord = parse_chord(chord)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._held = False
        self._scope = "window"

    def set_chord(self, chord) -> None:
        """Dynamically update chord and restart watcher if running."""
        new_chord = parse_chord(chord)
        if new_chord != self._chord:
            was_running = self._thread is not None and self._thread.is_alive()
            self._chord = new_chord
            if was_running:
                self.start()

    # ── state ───────────────────────────────────────────────────────────────

    @property
    def held(self) -> bool:
        return self._held

    @property
    def scope(self) -> str:
        """'global' once a system-wide hook is running, else 'window'."""
        return self._scope

    @property
    def label(self) -> str:
        return chord_label(self._chord)

    # ── lifecycle ───────────────────────────────────────────────────────────

    def start(self) -> str:
        """Begin watching. Returns the scope actually achieved."""
        self.stop()
        self._stop.clear()
        if _OS == "Windows" and self._can_poll():
            self._scope = "global"
            self._thread = threading.Thread(
                target=self._poll_loop, name="push-to-talk", daemon=True)
            self._thread.start()
        else:
            self._scope = "window"
        return self._scope

    def stop(self) -> None:
        self._stop.set()
        t, self._thread = self._thread, None
        if t is not None and t.is_alive():
            t.join(timeout=1.0)
        self._set_held(False)

    # ── the windowed fallback drives this directly ──────────────────────────

    def set_held(self, held: bool) -> None:
        """Feed a press/release from a Qt shortcut (non-Windows, or no hook)."""
        self._set_held(bool(held))

    # ── internals ───────────────────────────────────────────────────────────

    def _can_poll(self) -> bool:
        try:
            import ctypes
            ctypes.windll.user32.GetAsyncKeyState  # noqa: B018 — presence check
            return len(self._chord) > 0 and all(k in _VK for k in self._chord)
        except Exception:
            return False

    def _set_held(self, held: bool) -> None:
        if held == self._held:
            return
        self._held = held
        try:
            self._on_change(held)
        except Exception:
            pass          # a listener fault must never kill the watcher

    def _poll_loop(self) -> None:
        import ctypes
        user32 = ctypes.windll.user32
        codes = [_VK[k] for k in self._chord if k in _VK]
        if not codes:
            self._scope = "window"
            return
        period = 1.0 / _POLL_HZ
        down_since = 0.0

        while not self._stop.is_set():
            try:
                # The high bit of the return value is "currently down".
                down = all(user32.GetAsyncKeyState(c) & 0x8000 for c in codes)
            except Exception:
                break     # driver or session teardown — fall back to windowed
            self._set_held(bool(down))
            self._stop.wait(period)

        self._set_held(False)
        self._scope = "window"
