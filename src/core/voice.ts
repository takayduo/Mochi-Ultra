// Voice & Audio Coordinator for Mochi Ultra
// Connects Mochi's island UI with Mark-LV's Gemini Live Audio Engine (via Electron IPC)
import { Bridge } from "./bridge";
import { Sound } from "./sound";
import { State } from "./state";

let nextChatId = 1000;

class VoiceService {
  private onGeometryUpdate?: () => void;
  private currentAudioLevel = 0;

  init(onUpdate?: () => void) {
    this.onGeometryUpdate = onUpdate;

    // Listen for assistant state changes from Mark-LV Python engine
    Bridge.on("ai-state", (state: string) => {
      const st = String(state).toLowerCase();
      if (st === "speaking") {
        State.stateOverride = "finished";
        State.triggerEmote("happy");
      } else if (st === "thinking") {
        State.stateOverride = "thinking";
      } else if (st === "sleeping") {
        State.stateOverride = "sleeping";
      } else {
        // listening / idle
        State.stateOverride = null;
      }
      State.notify();
    });

    // Listen for live RMS audio levels (0.0 to 1.0) to drive the island waveform
    Bridge.on("ai-audio-level", (level: number) => {
      this.currentAudioLevel = Math.max(0, Math.min(1, Number(level) || 0));
      if (this.onGeometryUpdate) {
        this.onGeometryUpdate();
      }
    });

    // Listen for live transcripts (user speech and Mochi speech)
    Bridge.on("ai-transcript", (data: { role: string; text: string; speaker?: string }) => {
      if (!data || !data.text) return;
      const text = data.text.trim();
      if (!text) return;

      const role = data.role === "user" ? "user" : "assistant";

      // Prevent duplicate logging if already pushed
      const last = State.chatHistory[State.chatHistory.length - 1];
      if (last && last.role === role && last.content === text) {
        return;
      }

      State.chatHistory.push({
        id: nextChatId++,
        role,
        content: text,
      });

      if (role === "assistant") {
        State.triggerEmote("happy");
        Sound.play("finish");
      }

      State.notify();
    });

    // Initial mute state based on user settings
    const micOn = State.settings.micEnabled ?? true;
    Bridge.aiMute(!micOn).catch(() => {});
  }

  getAudioLevel(): number {
    return this.currentAudioLevel;
  }

  start() {
    Bridge.aiMute(false).catch(() => {});
  }

  stop() {
    Bridge.aiMute(true).catch(() => {});
  }

  async speak(text: string) {
    if (!text || !text.trim()) return;
    try {
      await Bridge.chatSend(text, null);
    } catch (e) {
      console.warn("[Voice] Speak error:", e);
    }
  }

  stopSpeech() {
    Bridge.aiInterrupt().catch(() => {});
  }

  isBusy(): boolean {
    return State.stateOverride === "thinking" || State.stateOverride === "finished";
  }
}

export const VoiceManager = new VoiceService();
