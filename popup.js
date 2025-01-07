// popup.js

document.addEventListener("DOMContentLoaded", async () => {
  const searchInput = document.getElementById("search");
  const tabList = document.getElementById("tab-list");

  // Get the tab history (array of tab IDs) from background.js
  const response = await chrome.runtime.sendMessage({
    command: "get-tab-history",
  });
  let historyTabIds = response.tabHistory;

  // For demonstration, we only want the last 4
  let lastFourIds = historyTabIds.slice(0, 4);

  // Convert them to detailed tab objects
  const tabsData = await Promise.all(
    lastFourIds.map(async (tabId) => {
      try {
        return await chrome.tabs.get(tabId);
      } catch (err) {
        // Tab might have closed, handle gracefully
        return null;
      }
    })
  );

  // Filter out any null (closed) tabs
  const validTabs = tabsData.filter((t) => t !== null);

  // Render the list
  validTabs.forEach((tab) => {
    const li = document.createElement("li");
    li.className = "tab-item";
    li.dataset.tabId = tab.id;

    // Thumbnail: either use tab.favIconUrl or a fallback
    const thumbnail = document.createElement("div");
    thumbnail.className = "tab-thumbnail";
    if (tab.favIconUrl) {
      thumbnail.style.backgroundImage = `url("${tab.favIconUrl}")`;
      thumbnail.style.backgroundSize = "cover";
    } else {
      // fallback: chrome://favicon or just a gray box
      thumbnail.style.background = "#ccc";
    }

    // Title
    const titleEl = document.createElement("div");
    titleEl.className = "tab-title";
    titleEl.textContent = tab.title;

    li.appendChild(thumbnail);
    li.appendChild(titleEl);
    tabList.appendChild(li);

    // Click handler: Activate that tab
    li.addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
    });
  });

  // (Optional) If you want to allow arrow-key navigation:
  let currentIndex = 0;
  function highlightCurrentItem() {
    const items = tabList.querySelectorAll(".tab-item");
    items.forEach((item, idx) => {
      item.style.backgroundColor = idx === currentIndex ? "#e0e0e0" : "";
    });
  }
  highlightCurrentItem();

  searchInput.addEventListener("keydown", (e) => {
    const items = tabList.querySelectorAll(".tab-item");
    if (e.key === "ArrowDown") {
      currentIndex = (currentIndex + 1) % items.length;
      highlightCurrentItem();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      currentIndex = (currentIndex - 1 + items.length) % items.length;
      highlightCurrentItem();
      e.preventDefault();
    } else if (e.key === "Enter") {
      // Activate the highlighted tab
      const tabIdToActivate = items[currentIndex].dataset.tabId;
      chrome.tabs.update(parseInt(tabIdToActivate, 10), { active: true });
    }
  });
});
