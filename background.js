// background.js

const STORAGE_KEY = "tabPreviews";
const HISTORY_KEY = "windowTabHistories";
let windowTabHistories = {};

// On install, initialize storage if needed
chrome.runtime.onInstalled.addListener(async () => {
  // Make sure the preview storage is initialized
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.local.set({ [STORAGE_KEY]: {} });
    }
  });

  loadTabHistoryFromStorage().catch((err) =>
    console.error("Failed to load tab history onInstalled:", err)
  );
});

/**
 * Load tabHistory from chrome.storage.local if available.
 */
async function loadTabHistoryFromStorage() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  windowTabHistories = data[HISTORY_KEY] || {};
}

/**
 * Save the current tabHistory to chrome.storage.local.
 */
async function saveTabHistoryToStorage() {
  await chrome.storage.local.set({ [HISTORY_KEY]: windowTabHistories });
}

/**
 * Initialize tabHistory on service worker startup.
 */
chrome.runtime.onStartup.addListener(() => {
  loadTabHistoryFromStorage().catch((err) =>
    console.error("Failed to load tab history onStartup:", err)
  );
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId, windowId } = activeInfo;

  // Remove the tab from history if it already exists (to avoid duplicates)
  await loadTabHistoryFromStorage();

  if (!windowTabHistories[windowId]) {
    windowTabHistories[windowId] = [];
  }

  // Remove the tab from the history if it already exists
  windowTabHistories[windowId] = windowTabHistories[windowId].filter(
    (id) => id !== tabId
  );

  // Insert the newly activated tab at the front
  windowTabHistories[windowId].unshift(tabId);

  // Keep only the last 4 tabs
  if (windowTabHistories[windowId].length > 4) {
    windowTabHistories[windowId].splice(4);
  }

  await saveTabHistoryToStorage();
  try {
    // Capture a screenshot of the active tab
    const dataUrl = await captureTabThrottled(windowId);
    if (!dataUrl) {
      console.warn("Capture skipped or failed.");
      return;
    }

    // Downscale in the service worker using OffscreenCanvas
    const processedDataUrl = await downscaleSmoothlyInWorker(dataUrl, 250, 156);

    // Retrieve existing previews
    const storageData = await chrome.storage.local.get(STORAGE_KEY);
    const previews = storageData[STORAGE_KEY] || {};

    // Store/Update the preview for this tab
    previews[tabId] = processedDataUrl;
    await chrome.storage.local.set({ [STORAGE_KEY]: previews });
  } catch (error) {
    console.error("Failed to capture tab:", error.message);
  }
});

// Listen for when a tab finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    try {
      // At this point, `tab` is active *and* fully loaded
      const dataUrl = await captureTabThrottled(tab.windowId);
      if (!dataUrl) {
        console.warn("Capture skipped or failed.");
        return;
      }

      const processedDataUrl = await downscaleSmoothlyInWorker(
        dataUrl,
        250,
        156
      );

      const storageData = await chrome.storage.local.get(STORAGE_KEY);
      const previews = storageData[STORAGE_KEY] || {};
      previews[tabId] = processedDataUrl;
      await chrome.storage.local.set({ [STORAGE_KEY]: previews });
    } catch (error) {
      console.error("Failed to capture tab:", error.message);
    }
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "get-tab-data") {
    const windowId = sender.tab.windowId;
    const localHistory = windowTabHistories[windowId] || [];
    const lastUsedTabIds = localHistory.slice(0, 4);

    // Fetch Tab objects + attach previews
    Promise.all(
      lastUsedTabIds.map((id) => chrome.tabs.get(id).catch(() => null))
    ).then((tabsArray) => {
      chrome.storage.local.get(STORAGE_KEY, (storageData) => {
        const previews = storageData[STORAGE_KEY] || {};
        const tabsWithPreviews = [];
        tabsArray.forEach((tab) => {
          if (tab) {
            const previewDataUrl = previews[tab.id] || null;
            tabsWithPreviews.push({ ...tab, preview: previewDataUrl });
          }
        });
        sendResponse({ tabs: tabsWithPreviews });
      });
    });
    return true; // asynchronous response
  }

  if (message.action === "switch-tab" && message.tabId) {
    chrome.tabs.update(message.tabId, { active: true });
  }
});

// Listen for keyboard shortcut command (Alt+Q)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "show-switcher-overlay") {
    // Query the currently active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const windowId = tab.windowId;
    if (
      !tab.url ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("https://chromewebstore.google.com") ||
      tab.url.startsWith("https://chrome.google.com")
    ) {
      console.warn("Cannot interact with restricted URL:", tab.url);
      chrome.tabs.update(windowTabHistories[windowId][1], { active: true });
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content-script.js"],
        injectImmediately: true,
        world: "ISOLATED",
      });
      await sendMessageWithRetry(tab.id, { action: "show-overlay" });
    } catch (error) {
      console.error("Error while handling command:", error.message);
    }
  }
});

/** Throttled + Timed Out Capture Logic */
async function captureTabWithRetry(windowId, attempts = 3, timeoutMs = 2000) {
  try {
    const capturePromise = chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
      quality: 50,
    });
    return await withTimeout(capturePromise, timeoutMs);
  } catch (error) {
    if (
      attempts > 1 &&
      error.message.includes("Tabs cannot be edited right now")
    ) {
      console.warn("Retrying capture... Attempts left:", attempts - 1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return captureTabWithRetry(windowId, attempts - 1, timeoutMs);
    }
    throw error;
  }
}

let lastCaptureTime = 0;
async function captureTabThrottled(windowId) {
  const now = Date.now();
  if (now - lastCaptureTime < 500) {
    console.warn("Capture skipped to avoid rate limit.");
    return null;
  }
  lastCaptureTime = now;

  return await captureTabWithRetry(windowId);
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function sendMessageWithRetry(tabId, message, attempts = 3) {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve(resp);
        }
      });
    });
    console.log("Message sent successfully:", response);
  } catch (error) {
    if (attempts > 1) {
      console.warn("Retrying message... Attempts left:", attempts - 1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return sendMessageWithRetry(tabId, message, attempts - 1);
    }
    console.error("Failed to send message after retries:", error);
  }
}

/**
 * Use OffscreenCanvas + createImageBitmap to downscale in the service worker
 */
async function downscaleSmoothlyInWorker(dataUrl, width, height) {
  const imageBitmap = await loadImageBitmap(dataUrl);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imageBitmap, 0, 0, width, height);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataURL(blob);
}

async function loadImageBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
