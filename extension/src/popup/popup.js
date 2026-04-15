import { MESSAGE_TYPES } from "../shared/constants.js";

const tasksEl = document.getElementById("tasks");
const emptyEl = document.getElementById("empty");
const openBriefingBtn = document.getElementById("open-briefing");

function formatAgo(ts) {
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function renderText(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  el.textContent = text;
  return el;
}

function renderTasks(tasks) {
  tasksEl.innerHTML = "";

  if (!tasks.length) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;

  for (const task of tasks) {
    const div = document.createElement("div");
    div.className = "task";
    div.appendChild(renderText("div", "task-title", task.title));
    div.appendChild(
      renderText(
        "div",
        "task-meta",
        `${task.stats.pageCount} pages • confidence ${Math.round(task.confidence * 100)}% • ${formatAgo(
          task.lastActivityTs
        )}`
      )
    );
    div.appendChild(renderText("div", "task-brief", task.briefing));
    tasksEl.appendChild(div);
  }
}

async function loadTasks() {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.GET_TASK_FEED,
    filters: { limit: 3 }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to load tasks");
  }

  renderTasks(response.tasks || []);
}

openBriefingBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OPEN_BRIEFING_PAGE });
  window.close();
});

loadTasks().catch((error) => {
  tasksEl.innerHTML = `<div class="task">${error.message}</div>`;
});
