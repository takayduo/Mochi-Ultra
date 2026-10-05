// Drop zone, upload progress and the "what do you want to do with it" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers the one
// action the spec asks for: ask a question about it.

import { h, clear } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { Sound } from "../core/sound";
import type { ViewActions, ViewHost } from "./views";

/** Dashed rounded rect drawn as SVG so the dashes can march like on macOS. */
function dashedFrame(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "drop-frame");
  el.setAttribute("preserveAspectRatio", "none");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "0.75");
  rect.setAttribute("y", "0.75");
  rect.setAttribute("width", "calc(100% - 1.5px)");
  rect.setAttribute("height", "calc(100% - 1.5px)");
  rect.setAttribute("rx", "20");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke-width", "1.5");
  rect.setAttribute("stroke-dasharray", "6 5");
  el.append(rect);
  return el;
}

export function buildUpload(): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title", text: "Drop your files here" });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["PDF", "Images", "Code", "Docs"].map((t) => h("span", { text: t })),
  );
  const card = h(
    "div",
    { class: "card drop-card" },
    frame,
    h("div", { class: "drop-body" }, title, tags),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
    },
  };
}

export function buildUploading(actions?: ViewActions): ViewHost {
  const label = h("span", { class: "up-name" });
  const percent = h("span", { class: "up-pct" });
  const cancelBtn = h("button", {
    class: "up-cancel",
    title: "Cancel upload",
    style: "background:rgba(255,255,255,0.06);border:none;border-radius:10px;color:rgba(255,255,255,0.6);cursor:pointer;font-size:11px;padding:2px 8px;margin-left:8px;",
    text: "Cancel ✕",
    onclick: () => {
      State.uploadProgress = 0;
      if (actions) actions.setView(State.defaultView());
    },
  });
  const fill = h("div", { class: "up-fill" });
  const glow = h("div", { class: "up-glow" });
  const card = h(
    "div",
    { class: "card up-card" },
    h("div", { class: "up-row", style: "display:flex;align-items:center;justify-content:space-between;" },
      label,
      h("div", { style: "display:flex;align-items:center;gap:4px;" }, percent, cancelBtn)
    ),
    h("div", { class: "up-track" }, fill, glow),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      const done = State.uploadProgress >= 0.999;
      const pct = Math.round(State.uploadProgress * 100);
      label.textContent = done
        ? `✓  ${State.droppedFile?.name ?? "File"}`
        : `Uploading ${State.droppedFile?.name ?? "file"}`;
      label.classList.toggle("done", done);
      percent.textContent = done ? "" : `${pct} %`;
      const w = State.uploadProgress * 526;
      fill.style.width = `${w}px`;
      glow.style.transform = `translateX(${Math.max(0, w - 14)}px)`;
      glow.style.opacity = State.uploadProgress > 0.01 ? "1" : "0";
      card.classList.toggle("done", done);
    },
  };
}

export function buildChoose(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });

  const settingsBtn = h("button", {
    class: "btn primary",
    text: "Open Settings ⚙",
    style: "display:none;",
    onclick: () => void Bridge.openSettingsWindow(),
  });

  const driveBtn = h("button", {
    class: "btn primary",
    text: "Open Drive ↗",
    onclick: () => {
      if (State.settings.gdriveFolderId) {
        actions.openUrl(`https://drive.google.com/drive/folders/${State.settings.gdriveFolderId}`);
      } else {
        actions.setView(State.defaultView());
      }
    },
  });

  const doneBtn = h("button", {
    class: "btn secondary",
    text: "Done",
    onclick: () => actions.setView(State.defaultView()),
  });

  const row = h("div", { class: "actions" }, settingsBtn, driveBtn, doneBtn);

  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title, sub, row),
    ),
  );

  return {
    el,
    sync() {
      clear(title);
      const partner = State.settings.partnerName || "Partner";
      const file = State.droppedFile;
      const fileName = file?.name ?? "File";

      if (file?.uploadedToDrive) {
        title.append(h("b", { text: fileName }), document.createTextNode(" uploaded!"));
        sub.textContent = `Uploaded to Google Drive • Notified ${partner} 💖`;
        settingsBtn.style.display = "none";
        driveBtn.className = "btn primary";
      } else if (!State.settings.gdriveUploadUrl) {
        title.append(h("b", { text: fileName }), document.createTextNode(" saved locally."));
        sub.textContent = `Connect your Drive Upload URL in Settings to sync with ${partner} 💖`;
        settingsBtn.style.display = "inline-flex";
        driveBtn.className = "btn secondary";
      } else {
        title.append(h("b", { text: fileName }), document.createTextNode(" uploaded!"));
        sub.textContent = `Uploaded to Google Drive • Notified ${partner} 💖`;
        settingsBtn.style.display = "none";
        driveBtn.className = "btn primary";
      }
    },
  };
}

export function buildPartnerFile(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const fileMeta = h("div", {
    style: "font-size:12px;font-weight:500;color:rgba(255,255,255,0.85);margin:4px 0 2px 0;display:flex;align-items:center;gap:6px;",
  });
  const sub = h("div", { class: "sub", style: "color:rgba(255,255,255,0.55);font-size:11.5px;margin-bottom:8px;" });

  const downloadBtn = h("button", {
    class: "btn primary",
    text: "⬇ Download File",
    onclick: async () => {
      const file = State.incomingFile;
      if (!file || file.downloading) return;
      file.downloading = true;
      downloadBtn.textContent = "Downloading... ⏳";
      downloadBtn.style.opacity = "0.7";
      State.notify();

      try {
        const res = await Bridge.downloadDriveFile(file);
        if (res.success && res.localPath) {
          file.downloading = false;
          file.downloadedPath = res.localPath;
          downloadBtn.textContent = "✓ Downloaded!";
          downloadBtn.style.opacity = "1";
          downloadBtn.style.background = "#22c55e";
          openFolderBtn.style.display = "inline-flex";
          const base = res.localPath.split(/[\\/]/).pop() || "file";
          sub.textContent = `Saved to Downloads (${base})`;
          Sound.play("approve");
          State.triggerEmote("happy");
        } else {
          file.downloading = false;
          downloadBtn.textContent = "Retry Download ↺";
          downloadBtn.style.opacity = "1";
          sub.textContent = `Download error: ${res.error || "Failed"}`;
          Sound.play("error");
        }
      } catch (err) {
        file.downloading = false;
        downloadBtn.textContent = "Retry Download ↺";
        downloadBtn.style.opacity = "1";
        sub.textContent = `Download failed: ${String(err)}`;
        Sound.play("error");
      }
      State.notify();
    },
  });

  const openFolderBtn = h("button", {
    class: "btn secondary",
    style: "display:none;align-items:center;gap:4px;",
    text: "Open in Downloads 📂",
    onclick: () => {
      if (State.incomingFile?.downloadedPath) {
        void Bridge.openPath(State.incomingFile.downloadedPath);
      }
    },
  });

  const openDriveBtn = h("button", {
    class: "btn secondary",
    text: "Open Drive ↗",
    onclick: () => {
      const file = State.incomingFile;
      if (file?.webViewLink) {
        actions.openUrl(file.webViewLink);
      } else if (State.settings.gdriveFolderId) {
        actions.openUrl(`https://drive.google.com/drive/folders/${State.settings.gdriveFolderId}`);
      }
    },
  });

  const dismissBtn = h("button", {
    class: "btn secondary",
    text: "✕ Dismiss",
    title: "Dismiss",
    style: "padding:0 12px;font-size:12px;",
    onclick: () => {
      State.incomingFile = null;
      State.isPinned = false;
      actions.setView(State.defaultView());
    },
  });

  const row = h(
    "div",
    { class: "actions", style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;" },
    downloadBtn,
    openFolderBtn,
    openDriveBtn,
    dismissBtn,
  );

  const card = h(
    "div",
    {
      class: "card",
      style: "border:1px solid rgba(244,63,94,0.35);background:linear-gradient(135deg,rgba(244,63,94,0.1),rgba(20,20,24,0.88));",
    },
    h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title, fileMeta, sub, row),
  );

  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      const file = State.incomingFile;
      if (!file) return;
      const partner = file.partnerName || State.settings.partnerName || "Partner";
      clear(title);
      title.append(
        h("span", { style: "color:#f43f5e;font-weight:600;margin-right:6px;", text: "💖" }),
        h("b", { text: `${partner} shared a file!` }),
      );

      const sizeMB = file.size ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : "Shared File";
      let icon = "📄";
      const nameLower = file.name.toLowerCase();
      if (nameLower.match(/\.(mp4|mov|mkv|avi|webm)$/)) icon = "🎬";
      else if (nameLower.match(/\.(png|jpg|jpeg|gif|webp)$/)) icon = "🖼️";
      else if (nameLower.match(/\.(zip|rar|7z|tar)$/)) icon = "📦";

      fileMeta.textContent = `${icon} ${file.name}  •  ${sizeMB}`;
      if (!file.downloadedPath && !file.downloading) {
        sub.textContent = "Would you like to download it to your PC?";
      }
    },
  };
}
