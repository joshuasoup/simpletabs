// content-script.js

let overlayContainer = null;
let itemsContainer = null;
let lastUsedTabs = [];
let currentIndex = 1;
let isOverlayOpen = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "show-overlay") {
    console.log("Received 'show-overlay' message.");
    openOverlay();
    sendResponse({ status: "overlay opened" });
  } else {
    sendResponse({ status: "error" });
  }
});

function createOverlayIfNeeded() {
  if (!overlayContainer) {
    overlayContainer = document.createElement("div");
    overlayContainer.id = "my-tab-switcher-overlay";
    overlayContainer.style.position = "fixed";
    overlayContainer.style.top = 0;
    overlayContainer.style.left = 0;
    overlayContainer.style.width = "100vw";
    overlayContainer.style.height = "100vh";
    overlayContainer.style.background = "rgba(0,0,0,0.5)";
    overlayContainer.style.display = "flex";
    overlayContainer.style.flexDirection = "column";
    overlayContainer.style.justifyContent = "center";
    overlayContainer.style.alignItems = "center";
    overlayContainer.style.zIndex = "999999";
    overlayContainer.style.visibility = "hidden";
    overlayContainer.style.color = "#fff";

    // allow it to receive focus
    overlayContainer.tabIndex = -1;

    document.body.appendChild(overlayContainer);
  }
}

async function openOverlay() {
  if (isOverlayOpen) {
    // Already open => cycle
    cycleForward();
    return;
  }
  isOverlayOpen = true;

  createOverlayIfNeeded();
  overlayContainer.innerHTML = "";

  overlayContainer.style.visibility = "visible";
  overlayContainer.focus();
  overlayContainer.addEventListener("keydown", onOverlayKeyDown);
  overlayContainer.addEventListener("keyup", onOverlayKeyUp);

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "get-tab-data" }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve(resp);
        }
      });
    });
    const { tabs } = response || {};
    if (!tabs) return;

    lastUsedTabs = tabs;
    currentIndex = 1;

    // Create container for the items
    itemsContainer = document.createElement("div");
    itemsContainer.style.background = "#333";
    itemsContainer.style.padding = "20px";
    itemsContainer.style.borderRadius = "20px";
    itemsContainer.style.maxHeight = "80vh";
    itemsContainer.style.overflow = "auto";
    itemsContainer.style.display = "flex";
    itemsContainer.style.flexDirection = "row";
    itemsContainer.style.alignItems = "center";
    itemsContainer.style.justifyContent = "flex-start";
    itemsContainer.style.gap = "8px";

    overlayContainer.appendChild(itemsContainer);

    buildItemsUI();
  } catch (error) {
    console.error("Failed to get tab data:", error);
    const errorEl = document.createElement("div");
    errorEl.textContent = "Failed to load tabs. Please try again.";
    errorEl.style.color = "red";
    overlayContainer.appendChild(errorEl);
  }
}

function buildItemsUI() {
  itemsContainer.innerHTML = "";
  lastUsedTabs.forEach((t, idx) => {
    const item = document.createElement("div");
    item.className = "tab-item";

    // If it's the selected item, highlight it
    if (idx === currentIndex) {
      item.style.background = "#1f1f1f";
      item.style.border = "2px solid transparent";
      item.style.boxShadow =
        "0 4px 8px 0 rgba(0, 0, 0, 0.2), 0 6px 10px 0 rgb(255 255 255 / 19%)";
    } else {
      item.style.border = "2px solid transparent";
    }

    // Show screenshot if available
    const previewDataUrl = t.preview;
    if (previewDataUrl) {
      const img = document.createElement("img");
      img.src = previewDataUrl;
      img.className = "tab-preview";
      item.appendChild(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "tab-preview-fallback";
      item.appendChild(fallback);
    }

    // Container for favicon and title
    const textContainer = document.createElement("div");
    textContainer.className = "tab-text-container";

    // Favicon
    if (t.favIconUrl) {
      const favicon = document.createElement("img");
      favicon.src = t.favIconUrl;
      favicon.className = "tab-favicon";
      favicon.style.width = "15px";
      favicon.style.height = "15px";
      textContainer.appendChild(favicon);
    }

    // Title
    const titleEl = document.createElement("span");
    titleEl.textContent = t.title || t.url;
    titleEl.className = "tab-title";
    textContainer.appendChild(titleEl);

    item.appendChild(textContainer);

    // On click => switch to that tab
    item.addEventListener("click", () => {
      finalizeSelection(idx);
    });

    // Hover highlight (CSS or JS). We'll do JS quickly:
    item.addEventListener("mouseover", () => {
      item.style.border = "2px solid #888";
    });
    item.addEventListener("mouseout", () => {
      if (idx === currentIndex) {
        item.style.background = "#1f1f1f";
        item.style.border = "2px solid transparent";
      } else {
        item.style.border = "2px solid transparent";
      }
    });

    itemsContainer.appendChild(item);
  });
}

function cycleForward() {
  const oldIndex = currentIndex;
  currentIndex = (currentIndex + 1) % lastUsedTabs.length;
  buildItemsUI(); // re-build so the highlight moves
}

function onKeyDown(e) {
  // If alt is not pressed => finalize
  if (!e.altKey) {
    finalizeSelection(currentIndex);
    return;
  }
  // if alt is pressed + q => cycle
  if (e.key.toLowerCase() === "q") {
    e.preventDefault();
    cycleForward();
  }
}

function finalizeSelection(index) {
  closeOverlay();
  if (lastUsedTabs[index]) {
    chrome.runtime.sendMessage({
      action: "switch-tab",
      tabId: lastUsedTabs[index].id,
    });
  }
}

function closeOverlay() {
  overlayContainer.style.visibility = "hidden";
  overlayContainer.removeEventListener("keydown", onKeyDown);
  isOverlayOpen = false;
}

function escKeyListener(e) {
  if (e.key === "Escape") {
    closeOverlay();
  }
}

function onOverlayKeyUp(e) {
  // If altKey is false, it means Alt was just released
  if (!e.altKey) {
    e.preventDefault();
    finalizeSelection(currentIndex);
  }
}

function onOverlayKeyDown(e) {
  if (e.key.toLowerCase() === "q" && e.altKey) {
    e.preventDefault();
    cycleForward();
  }
  if (e.key === "Escape") {
    closeOverlay();
  }
}
