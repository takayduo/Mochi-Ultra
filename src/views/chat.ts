// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import { VoiceManager } from "../core/voice";
import type { ViewHost } from "./views";

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

function userProfileBadge(): HTMLElement {
  const isMe = (State.settings.userRole || "me") === "me";
  const myName = (State.settings.userName && State.settings.userName !== "Me" ? State.settings.userName : "Badsha");
  const partnerName = (State.settings.partnerName && State.settings.partnerName !== "Her" ? State.settings.partnerName : "Ayzil");
  const activeName = isMe ? myName : partnerName;
  const icon = isMe ? "👤" : "💖";
  const color = isMe ? "#38bdf8" : "#f43f5e";

  const badge = h(
    "button",
    {
      class: "chip",
      title: `Active user: ${activeName}. Click to toggle who is using this PC!`,
      style: "cursor:pointer;border:none;background:rgba(255,255,255,0.08);padding:3px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,0.85);margin-right:6px",
      onclick: async () => {
        Sound.play("blip");
        const nextRole = isMe ? "her" : "me";
        State.settings.userRole = nextRole;
        await Bridge.saveSettings(State.settings);
        State.notify();
      },
    },
    h("i", { class: "chip-dot", style: `background:${color}` }),
    h("span", { text: `${icon} ${activeName}` }),
    h("span", { style: "opacity:0.45;font-size:10px", text: "⇄" })
  );
  return badge;
}

function engineBadge(): HTMLElement {
  const voice = State.settings.voiceName || "Charon";
  const badge = h(
    "button",
    {
      class: "chip",
      title: `Gemini Live Engine (Voice: ${voice}). Click to configure in Settings.`,
      style: "cursor:pointer;border:none;background:rgba(255,255,255,0.08);padding:3px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,0.85);margin-right:6px",
      onclick: () => {
        Sound.play("blip");
        void Bridge.openSettingsWindow();
      },
    },
    h("i", { class: "chip-dot", style: "background:#3b82f6" }),
    h("span", { text: `🎙️ ${voice}` })
  );
  return badge;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row", style: "display:flex;align-items:center;gap:6px" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Ask me anything…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, log, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    input.value = "";
    sending = true;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const context: ChatContext | null = null;

    try {
      const reply = await Bridge.chatSend(query, context);
      if (reply && reply.text && reply.text !== "(Command sent to Mochi)") {
        const lastMsg = State.chatHistory[State.chatHistory.length - 1];
        if (!lastMsg || lastMsg.content !== reply.text) {
          State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
        }
        void VoiceManager.speak(reply.text);
      }
      State.stateOverride = null;
      State.triggerEmote("happy");
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      const curVoice = State.settings.voiceName || "Charon";
      const curRole = State.settings.userRole || "me";
      if (
        chipRow.dataset.voice !== curVoice ||
        chipRow.dataset.role !== curRole
      ) {
        chipRow.dataset.voice = curVoice;
        chipRow.dataset.role = curRole;
        clear(chipRow);
        chipRow.append(userProfileBadge(), engineBadge());
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      input.placeholder = State.chatHistory.length === 0 ? "Ask me anything…" : "Continue…";
      input.disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
