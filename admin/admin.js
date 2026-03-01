(function () {
  const API = {
    login: "/api/admin/login",
    config: "/api/admin/config",
    directories: "/api/admin/directories",
  };

  const TOKEN_KEY = "gallery_admin_token";
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let latestConfig = null;
  let directoryTree = null;
  let currentDirectoryPath = "";

  const loginPanel = document.getElementById("login-panel");
  const dashboardPanel = document.getElementById("dashboard-panel");
  const statusText = document.getElementById("status-text");

  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  const logoutBtn = document.getElementById("logout-btn");
  const domainInput = document.getElementById("domain-input");
  const loadConfigBtn = document.getElementById("load-config-btn");

  const configForm = document.getElementById("config-form");
  const saveConfigBtn = document.getElementById("save-config-btn");
  const resetConfigBtn = document.getElementById("reset-config-btn");

  const galleryDataModeInput = document.getElementById("gallery-data-mode");
  const displayModeInput = document.getElementById("display-mode");
  const shuffleEnabledInput = document.getElementById("shuffle-enabled");
  const galleryIndexUrlInput = document.getElementById("gallery-index-url");
  const siteTitleInput = document.getElementById("site-title");
  const siteImageUrlInput = document.getElementById("site-image-url");
  const imgbedBaseUrlInput = document.getElementById("imgbed-base-url");
  const imgbedApiTokenInput = document.getElementById("imgbed-api-token");
  const imgbedListEndpointInput = document.getElementById("imgbed-list-endpoint");
  const imgbedRandomEndpointInput = document.getElementById("imgbed-random-endpoint");
  const imgbedRandomOrientationInput = document.getElementById("imgbed-random-orientation");
  const imgbedFilePrefixInput = document.getElementById("imgbed-file-prefix");
  const imgbedListDirInput = document.getElementById("imgbed-list-dir");
  const imgbedPreviewDirInput = document.getElementById("imgbed-preview-dir");
  const imgbedPageSizeInput = document.getElementById("imgbed-page-size");
  const imgbedRecursiveInput = document.getElementById("imgbed-recursive");
  const publicUploadEnabledInput = document.getElementById("public-upload-enabled");
  const publicUploadButtonTextInput = document.getElementById("public-upload-button-text");
  const publicUploadModalTitleInput = document.getElementById("public-upload-modal-title");
  const publicUploadDescriptionInput = document.getElementById("public-upload-description");
  const fetchDirsBtn = document.getElementById("fetch-dirs-btn");
  const dirPicker = document.getElementById("dir-picker");
  const dirRootBtn = document.getElementById("dir-root-btn");
  const dirUpBtn = document.getElementById("dir-up-btn");
  const dirSelectBtn = document.getElementById("dir-select-btn");
  const dirCurrentPathText = document.getElementById("dir-current-path");
  const dirBreadcrumb = document.getElementById("dir-breadcrumb");
  const dirChildren = document.getElementById("dir-children");

  function setStatus(message, level = "info") {
    statusText.textContent = message;
    statusText.dataset.level = level;
  }

  function setButtonLoading(button, loading, loadingText, defaultText) {
    if (!button) return;
    button.disabled = loading;
    button.textContent = loading ? loadingText : defaultText;
  }

  function normalizeDomain(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";

    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .toLowerCase();
  }

  function normalizeDirPath(input) {
    return String(input || "")
      .trim()
      .replace(/^\/+|\/+$/g, "");
  }

  async function requestApi(url, options = {}, requiresAuth = false) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };

    if (requiresAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `请求失败：HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function clearDirectoryPicker() {
    directoryTree = null;
    currentDirectoryPath = "";

    if (dirPicker) {
      dirPicker.classList.add("hidden");
    }
    if (dirCurrentPathText) {
      dirCurrentPathText.textContent = "当前目录：/";
    }
    if (dirBreadcrumb) {
      dirBreadcrumb.innerHTML = "";
    }
    if (dirChildren) {
      dirChildren.innerHTML = "";
    }
  }

  function findDirectoryNode(path) {
    if (!directoryTree) return null;
    const normalized = normalizeDirPath(path);
    if (!normalized) return directoryTree;

    const parts = normalized.split("/").filter(Boolean);
    let node = directoryTree;

    for (const part of parts) {
      const children = Array.isArray(node.children) ? node.children : [];
      const next = children.find((item) => item.name === part);
      if (!next) return null;
      node = next;
    }

    return node;
  }

  function renderDirectoryBreadcrumb(path) {
    if (!dirBreadcrumb) return;
    dirBreadcrumb.innerHTML = "";

    const rootBtn = document.createElement("button");
    rootBtn.type = "button";
    rootBtn.className = "secondary-btn";
    rootBtn.textContent = "/";
    rootBtn.addEventListener("click", () => {
      currentDirectoryPath = "";
      renderDirectoryPicker();
    });
    dirBreadcrumb.appendChild(rootBtn);

    const segments = normalizeDirPath(path).split("/").filter(Boolean);
    let cursor = "";

    segments.forEach((segment) => {
      cursor = cursor ? `${cursor}/${segment}` : segment;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.textContent = segment;
      const targetPath = cursor;
      button.addEventListener("click", () => {
        currentDirectoryPath = targetPath;
        renderDirectoryPicker();
      });
      dirBreadcrumb.appendChild(button);
    });
  }

  function renderDirectoryPicker() {
    if (!dirPicker || !dirCurrentPathText || !dirChildren) return;
    if (!directoryTree) {
      clearDirectoryPicker();
      return;
    }

    dirPicker.classList.remove("hidden");

    let normalizedPath = normalizeDirPath(currentDirectoryPath);
    let node = findDirectoryNode(normalizedPath);
    if (!node) {
      normalizedPath = "";
      node = directoryTree;
      currentDirectoryPath = "";
    }

    const pathLabel = normalizedPath ? `/${normalizedPath}` : "/";
    dirCurrentPathText.textContent = `当前目录：${pathLabel}`;
    renderDirectoryBreadcrumb(normalizedPath);

    dirChildren.innerHTML = "";
    const children = Array.isArray(node.children) ? node.children : [];

    if (!children.length) {
      const empty = document.createElement("p");
      empty.className = "dir-empty";
      empty.textContent = "当前层没有子目录，可直接使用当前目录。";
      dirChildren.appendChild(empty);
      return;
    }

    children.forEach((child) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dir-node-btn";
      button.textContent = child.name;
      button.addEventListener("click", () => {
        currentDirectoryPath = child.path;
        renderDirectoryPicker();
      });
      dirChildren.appendChild(button);
    });
  }

  function selectCurrentDirectoryPath() {
    const normalizedPath = normalizeDirPath(currentDirectoryPath);
    imgbedListDirInput.value = normalizedPath;
    const label = normalizedPath ? `/${normalizedPath}` : "/";
    setStatus(`已选择目录：${label}`, "success");
  }

  function goToDirectoryParent() {
    const parts = normalizeDirPath(currentDirectoryPath).split("/").filter(Boolean);
    parts.pop();
    currentDirectoryPath = parts.join("/");
    renderDirectoryPicker();
  }

  async function fetchDirectories() {
    const domain = normalizeDomain(domainInput.value) || window.location.host;
    domainInput.value = domain;

    const config = collectConfigFromForm();
    const baseUrl = String(config?.imgbed?.baseUrl || "").trim();
    if (!baseUrl) {
      setStatus("请先填写 ImgBed 基础地址。", "error");
      imgbedBaseUrlInput.focus();
      return;
    }

    setButtonLoading(fetchDirsBtn, true, "获取中...", "获取目录");
    setStatus("正在获取目录列表...");

    try {
      const payload = await requestApi(
        API.directories,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            imgbed: config.imgbed,
          }),
        },
        true
      );

      directoryTree = payload?.data?.tree || { name: "", path: "", children: [] };
      currentDirectoryPath = normalizeDirPath(imgbedListDirInput.value || payload?.data?.sourceListDir || "");
      renderDirectoryPicker();
      setStatus(`目录获取成功，共 ${Number(payload?.data?.directoryCount || 0)} 个目录。`, "success");
    } catch (error) {
      if (error.status === 401) {
        token = "";
        localStorage.removeItem(TOKEN_KEY);
        showLoginPanel();
        setStatus("登录已过期，请重新登录。", "error");
        return;
      }
      setStatus(`获取目录失败：${error.message}`, "error");
    } finally {
      setButtonLoading(fetchDirsBtn, false, "获取中...", "获取目录");
    }
  }

  function showLoginPanel() {
    loginPanel.classList.remove("hidden");
    dashboardPanel.classList.add("hidden");
    usernameInput.focus();
  }

  function showDashboardPanel() {
    loginPanel.classList.add("hidden");
    dashboardPanel.classList.remove("hidden");
    domainInput.focus();
  }

	  function collectConfigFromForm() {
	    const pageSize = Number(imgbedPageSizeInput.value);
	    return {
	      galleryDataMode: galleryDataModeInput.value || "static",
	      displayMode: displayModeInput.value || "fullscreen",
	      shuffleEnabled: Boolean(shuffleEnabledInput.checked),
	      galleryIndexUrl: galleryIndexUrlInput.value.trim(),
	      site: {
	        title: siteTitleInput?.value.trim(),
	        imageUrl: siteImageUrlInput?.value.trim(),
	      },
	      imgbed: {
	        baseUrl: imgbedBaseUrlInput.value.trim(),
	        apiToken: imgbedApiTokenInput.value.trim(),
	        listEndpoint: imgbedListEndpointInput.value.trim(),
        randomEndpoint: imgbedRandomEndpointInput.value.trim(),
        randomOrientation: (imgbedRandomOrientationInput?.value || "").trim(),
        fileRoutePrefix: imgbedFilePrefixInput.value.trim() || "/file",
        listDir: imgbedListDirInput.value.trim(),
        previewDir: imgbedPreviewDirInput.value.trim() || "0_preview",
        recursive: Boolean(imgbedRecursiveInput.checked),
        pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 500) : 200,
      },
      publicUpload: {
        enabled: Boolean(publicUploadEnabledInput.checked),
        buttonText: publicUploadButtonTextInput.value.trim(),
        modalTitle: publicUploadModalTitleInput.value.trim(),
        description: publicUploadDescriptionInput.value.trim(),
      },
    };
  }

	  function fillConfigForm(config) {
	    const safe = config || {};
	    galleryDataModeInput.value = safe.galleryDataMode === "imgbed-api" ? "imgbed-api" : "static";
	    displayModeInput.value = safe.displayMode === "waterfall" ? "waterfall" : "fullscreen";
	    shuffleEnabledInput.checked = safe.shuffleEnabled !== false;
	    galleryIndexUrlInput.value = safe.galleryIndexUrl || "";
	    if (siteTitleInput) {
	      siteTitleInput.value = safe.site?.title || "";
	    }
	    if (siteImageUrlInput) {
	      siteImageUrlInput.value = safe.site?.imageUrl || "";
	    }
	    imgbedBaseUrlInput.value = safe.imgbed?.baseUrl || "";
	    imgbedApiTokenInput.value = safe.imgbed?.apiToken || "";
	    imgbedListEndpointInput.value = safe.imgbed?.listEndpoint || "";
    imgbedRandomEndpointInput.value = safe.imgbed?.randomEndpoint || "";
    if (imgbedRandomOrientationInput) {
      const savedOrientation = String(safe.imgbed?.randomOrientation || "").trim().toLowerCase();
      const knownOptions = ["", "auto", "landscape", "portrait", "square"];
      imgbedRandomOrientationInput.value = knownOptions.includes(savedOrientation) ? savedOrientation : "";
    }
    imgbedFilePrefixInput.value = safe.imgbed?.fileRoutePrefix || "/file";
    imgbedListDirInput.value = safe.imgbed?.listDir || "";
    imgbedPreviewDirInput.value = safe.imgbed?.previewDir || "0_preview";
    imgbedPageSizeInput.value = String(safe.imgbed?.pageSize || 200);
    imgbedRecursiveInput.checked = safe.imgbed?.recursive !== false;
    publicUploadEnabledInput.checked = safe.publicUpload?.enabled === true;
    publicUploadButtonTextInput.value = safe.publicUpload?.buttonText || "上传图片";
    publicUploadModalTitleInput.value = safe.publicUpload?.modalTitle || "上传图片";
    publicUploadDescriptionInput.value =
      safe.publicUpload?.description || "请填写图片描述并选择图片后上传。";

    if (directoryTree) {
      currentDirectoryPath = normalizeDirPath(safe.imgbed?.listDir || "");
      renderDirectoryPicker();
    }
  }

  function resetConfigForm() {
    if (latestConfig) {
      fillConfigForm(latestConfig);
      setStatus("已恢复到最近一次读取的配置。");
      return;
    }
    clearDirectoryPicker();
	    fillConfigForm({
	      galleryDataMode: "static",
	      displayMode: "fullscreen",
	      shuffleEnabled: true,
	      galleryIndexUrl: "",
	      site: {
	        title: "Gallery-Portfolio",
	        imageUrl: "",
	      },
	      imgbed: {
	        baseUrl: "",
	        apiToken: "",
	        listEndpoint: "/api/manage/list",
        randomEndpoint: "/random",
        randomOrientation: "",
        fileRoutePrefix: "/file",
        listDir: "",
        previewDir: "0_preview",
        recursive: true,
        pageSize: 200,
      },
      publicUpload: {
        enabled: false,
        buttonText: "上传图片",
        modalTitle: "上传图片",
        description: "请填写图片描述并选择图片后上传。",
      },
    });
    setStatus("已重置为默认配置。");
  }

  async function loadDomainConfig() {
    const domain = normalizeDomain(domainInput.value) || window.location.host;
    domainInput.value = domain;

    setButtonLoading(loadConfigBtn, true, "读取中...", "读取配置");
    setStatus(`正在读取 ${domain} 的配置...`);

    try {
      const payload = await requestApi(`${API.config}?domain=${encodeURIComponent(domain)}`, {}, true);
      const { config, storageBackend, matchedDomain } = payload.data;
      latestConfig = config;
      clearDirectoryPicker();
      fillConfigForm(config);
      const domainHint =
        matchedDomain && matchedDomain !== domain
          ? `（命中回退域名：${matchedDomain}）`
          : "";
      setStatus(`读取成功，当前存储：${storageBackend}${domainHint}`, "success");
    } catch (error) {
      if (error.status === 401) {
        token = "";
        localStorage.removeItem(TOKEN_KEY);
        showLoginPanel();
        setStatus("登录已过期，请重新登录。", "error");
        return;
      }
      setStatus(`读取失败：${error.message}`, "error");
    } finally {
      setButtonLoading(loadConfigBtn, false, "读取中...", "读取配置");
    }
  }

  async function login(event) {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      setStatus("请输入账号和密码。", "error");
      return;
    }

    setButtonLoading(loginBtn, true, "登录中...", "登录");
    setStatus("正在验证身份...");

    try {
      const payload = await requestApi(API.login, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      token = payload.data.token;
      localStorage.setItem(TOKEN_KEY, token);
      passwordInput.value = "";
      showDashboardPanel();
      setStatus("登录成功。", "success");

      if (!domainInput.value.trim()) {
        domainInput.value = window.location.host;
      }
      await loadDomainConfig();
    } catch (error) {
      setStatus(`登录失败：${error.message}`, "error");
    } finally {
      setButtonLoading(loginBtn, false, "登录中...", "登录");
    }
  }

  async function saveConfig(event) {
    event.preventDefault();
    const domain = normalizeDomain(domainInput.value) || window.location.host;
    domainInput.value = domain;

    const config = collectConfigFromForm();
    setButtonLoading(saveConfigBtn, true, "保存中...", "保存配置");
    setStatus(`正在保存 ${domain} 的配置...`);

    try {
      const payload = await requestApi(
        API.config,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, config }),
        },
        true
      );

      latestConfig = payload.data.config;
      fillConfigForm(latestConfig);
      setStatus(`保存成功，当前存储：${payload.data.storageBackend}`, "success");
    } catch (error) {
      if (error.status === 401) {
        token = "";
        localStorage.removeItem(TOKEN_KEY);
        showLoginPanel();
        setStatus("登录已过期，请重新登录。", "error");
        return;
      }
      setStatus(`保存失败：${error.message}`, "error");
    } finally {
      setButtonLoading(saveConfigBtn, false, "保存中...", "保存配置");
    }
  }

  function logout() {
    token = "";
    latestConfig = null;
    clearDirectoryPicker();
    localStorage.removeItem(TOKEN_KEY);
    showLoginPanel();
    setStatus("已退出登录。");
  }

  async function bootstrap() {
    domainInput.value = window.location.host;
    resetConfigForm();

    loginForm.addEventListener("submit", login);
    configForm.addEventListener("submit", saveConfig);
    loadConfigBtn.addEventListener("click", loadDomainConfig);
    resetConfigBtn.addEventListener("click", resetConfigForm);
    logoutBtn.addEventListener("click", logout);
    fetchDirsBtn?.addEventListener("click", fetchDirectories);
    dirRootBtn?.addEventListener("click", () => {
      currentDirectoryPath = "";
      renderDirectoryPicker();
    });
    dirUpBtn?.addEventListener("click", goToDirectoryParent);
    dirSelectBtn?.addEventListener("click", selectCurrentDirectoryPath);
    imgbedListDirInput?.addEventListener("change", () => {
      if (!directoryTree) return;
      currentDirectoryPath = normalizeDirPath(imgbedListDirInput.value);
      renderDirectoryPicker();
    });

    if (!token) {
      showLoginPanel();
      return;
    }

    showDashboardPanel();
    await loadDomainConfig();
  }

  bootstrap();
})();
