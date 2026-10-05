// Creator Couple Daily Schedule View — styled to match Coucou's cards.
import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ScheduleItem } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { ViewActions, ViewHost } from "./views";

function getScheduleRoleInfo() {
  const isMe = (State.settings.userRole || "me") === "me";
  const currentUserRole: "me" | "her" = isMe ? "me" : "her";
  const partnerRole: "me" | "her" = isMe ? "her" : "me";
  const rawMe = isMe ? (State.settings.userName || "Badsha") : (State.settings.partnerName || "Ayzil");
  const rawPartner = isMe ? (State.settings.partnerName || "Ayzil") : (State.settings.userName || "Badsha");
  const currentUserName = (rawMe.charAt(0).toUpperCase() + rawMe.slice(1)) || "Me";
  const partnerUserName = (rawPartner.charAt(0).toUpperCase() + rawPartner.slice(1)) || "Partner";
  const currentUserIcon = isMe ? "👤" : "💖";
  const partnerIcon = isMe ? "💖" : "👤";
  return {
    isMe,
    currentUserRole,
    partnerRole,
    currentUserName,
    partnerUserName,
    currentUserIcon,
    partnerIcon,
  };
}

export function buildSchedule(actions: ViewActions): ViewHost {
  const info0 = getScheduleRoleInfo();
  // Active user's tab is ALWAYS first, partner's tab is ALWAYS second
  const toggleUser = h("button", { class: "sched-toggle active", text: `${info0.currentUserName} ${info0.currentUserIcon}` });
  const togglePartner = h("button", { class: "sched-toggle", text: `${info0.partnerUserName} ${info0.partnerIcon}` });
  const toggleBar = h("div", { class: "sched-toggles" }, toggleUser, togglePartner);

  const headerTitle = h("div", { class: "sched-title", text: "Today's Content Plan" });
  const presenceBadge = h("span", {
    class: "sched-presence-badge",
    style: "font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:auto;margin-right:10px;background:rgba(34,197,94,0.15);color:#22c55e;display:none;align-items:center;gap:4px;",
    text: "🟢 Online",
  });
  const topRow = h("div", { class: "sched-header-row" }, headerTitle, presenceBadge, toggleBar);

  const listEl = h("div", { class: "sched-list" });

  const inputTitle = h("input", {
    type: "text",
    class: "sched-input",
    placeholder: "Add task (e.g. Record YouTube video)...",
  }) as HTMLInputElement;

  const inputTime = h("input", {
    type: "text",
    class: "sched-time-input",
    placeholder: "11:00 AM",
    value: "11:00 AM",
  }) as HTMLInputElement;

  const addBtn = h("button", { class: "sched-add-btn", title: "Add Task" }, svg(ICONS.plus, 12));

  const addRow = h("div", { class: "sched-add-row" }, inputTitle, inputTime, addBtn);

  const cardBody = h("div", { class: "sched-body" }, topRow, listEl, addRow);
  const el = h("div", { class: "view schedule-view" }, h("div", { class: "card wash" }, cardBody));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(244, 80, 94, 0.28)");

  let lastUserRole = State.settings.userRole || "me";
  let currentFilter: "me" | "her" = State.scheduleFilter || info0.currentUserRole;

  function updateToggles() {
    const info = getScheduleRoleInfo();
    toggleUser.textContent = `${info.currentUserName} ${info.currentUserIcon}`;
    togglePartner.textContent = `${info.partnerUserName} ${info.partnerIcon}`;
    toggleUser.classList.toggle("active", currentFilter === info.currentUserRole);
    togglePartner.classList.toggle("active", currentFilter === info.partnerRole);

    if (currentFilter === info.currentUserRole) {
      inputTitle.placeholder = `Add task for yourself (e.g. Record video)...`;
    } else {
      inputTitle.placeholder = `Add task for ${info.partnerUserName} (e.g. Edit thumbnails)...`;
    }
  }

  function setFilter(filter: "me" | "her") {
    currentFilter = filter;
    State.scheduleFilter = filter;
    updateToggles();
    Sound.play("blip");
    renderList();
  }

  toggleUser.addEventListener("click", () => {
    const info = getScheduleRoleInfo();
    setFilter(info.currentUserRole);
  });
  togglePartner.addEventListener("click", () => {
    const info = getScheduleRoleInfo();
    setFilter(info.partnerRole);
  });

  async function addTask() {
    const title = inputTitle.value.trim();
    const time = inputTime.value.trim() || "12:00 PM";
    if (!title) return;

    const info = getScheduleRoleInfo();

    const newItem: ScheduleItem = {
      id: "task-" + Date.now(),
      title,
      time,
      assignee: currentFilter,
      assignedBy: info.currentUserRole,
      completed: false,
      createdAt: Date.now(),
    };

    inputTitle.value = "";
    Sound.play("pop");
    State.schedule.push(newItem);
    renderList();

    try {
      const updated = await Bridge.saveScheduleItem(newItem);
      if (updated && updated.length) State.schedule = updated;
      renderList();
    } catch (err) {
      console.error("Save schedule error:", err);
    }
  }

  addBtn.addEventListener("click", () => void addTask());
  inputTitle.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void addTask();
    }
  });

  async function toggleDone(task: ScheduleItem) {
    task.completed = !task.completed;
    if (task.completed) {
      Sound.play("finish");
      State.stateOverride = "finished";
      setTimeout(() => {
        State.stateOverride = null;
        State.notify();
      }, 1500);
    } else {
      Sound.play("blip");
    }
    renderList();

    try {
      const updated = await Bridge.toggleScheduleItem(task.id);
      if (updated && updated.length) State.schedule = updated;
      renderList();
    } catch (err) {
      console.error("Toggle item error:", err);
    }
  }

  async function deleteTask(id: string) {
    Sound.play("blip");
    State.schedule = State.schedule.filter((s) => s.id !== id);
    renderList();
    try {
      const updated = await Bridge.deleteScheduleItem(id);
      if (updated && updated.length) State.schedule = updated;
      renderList();
    } catch (err) {
      console.error("Delete item error:", err);
    }
  }

  function renderList() {
    clear(listEl);
    const info = getScheduleRoleInfo();
    const items = State.schedule.filter((s) => s.assignee === currentFilter);

    if (items.length === 0) {
      const empty = h(
        "div",
        { class: "sched-empty" },
        h("span", {
          text: currentFilter === info.currentUserRole
            ? `No tasks for you today! Relax or let ${info.partnerUserName} plan your day ✨`
            : `No tasks set for ${info.partnerUserName} yet. Plan something sweet for ${info.partnerUserName}'s day! ${info.partnerIcon}`,
        })
      );
      listEl.append(empty);
      return;
    }

    for (const item of items) {
      const checkBtn = h(
        "button",
        { class: item.completed ? "sched-check checked" : "sched-check" },
        item.completed ? svg(ICONS.check, 10, { stroke: 3 }) : null
      );
      checkBtn.addEventListener("click", () => void toggleDone(item));

      const timeEl = h("span", { class: "sched-item-time", text: item.time });
      const titleEl = h("span", { class: "sched-item-title", text: item.title });

      // Task attribution badge:
      // If task was added by the person currently looking at this PC, show "By You ✨"
      // If task was added by the partner, show "By <PartnerName> <Icon>"
      const assignedLabel =
        item.assignedBy && item.assignedBy !== item.assignee
          ? h("span", {
              class: "sched-item-badge",
              text: item.assignedBy === info.currentUserRole ? "By You ✨" : `By ${info.partnerUserName} ${info.partnerIcon}`,
            })
          : null;

      const delBtn = h(
        "button",
        { class: "sched-del-btn", title: "Delete" },
        svg(ICONS.xmark, 8)
      );
      delBtn.addEventListener("click", () => void deleteTask(item.id));

      const row = h(
        "div",
        { class: item.completed ? "sched-item done" : "sched-item" },
        checkBtn,
        timeEl,
        titleEl,
        assignedLabel,
        delBtn
      );
      listEl.append(row);
    }
  }

  return {
    el,
    sync() {
      const info = getScheduleRoleInfo();

      // If user profile switched in settings, prioritize the newly active user!
      const currentRole = State.settings.userRole || "me";
      if (lastUserRole !== currentRole) {
        lastUserRole = currentRole;
        currentFilter = info.currentUserRole;
        State.scheduleFilter = currentFilter;
      }

      updateToggles();

      if (State.partnerOnline) {
        presenceBadge.style.display = "inline-flex";
        presenceBadge.textContent = `🟢 ${info.partnerUserName} Online`;
        togglePartner.title = `${info.partnerUserName} is currently online!`;
      } else {
        presenceBadge.style.display = "none";
        togglePartner.title = `${info.partnerUserName} is offline`;
      }

      renderList();
    },
    focus() {
      inputTitle.focus();
    },
  };
}
