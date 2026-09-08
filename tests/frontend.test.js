import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sources = Object.fromEntries(await Promise.all(
  ["data-loader", "image-loader", "gallery", "tag-filter"].map(async (name) => [
    name, await readFile(new URL(`../public/${name}.js`, import.meta.url), "utf8"),
  ])
));

function createBrowser() {
  const pendingImages = [];
  const storage = new Map();
  const session = new Map();
  const frames = [];
  const elements = new Map();
  const history = [];
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.offsetHeight = 0;
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
      };
    }
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      if (child.id) elements.set(child.id, child);
    }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
    replaceWith(child) {
      if (!this.parentNode) return;
      const parent = this.parentNode;
      parent.children.splice(parent.children.indexOf(this), 1, child);
      child.parentNode = parent;
      this.parentNode = null;
    }
    addEventListener() {}
    removeEventListener() {}
  }
  class Image extends Element {
    constructor() { super("img"); }
    set src(value) { this._src = value; if (value) pendingImages.push(this); }
    get src() { return this._src; }
  }
  const gallery = new Element();
  gallery.style.opacity = "1";
  const loadedImages = () => gallery.children.flatMap((column) => column.children);
  const document = {
    body: new Element(),
    head: new Element(),
    createElement: (tag) => new Element(tag),
    addEventListener() {},
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: () => loadedImages(),
    querySelector(selector) {
      if (selector === "header") return { offsetHeight: 0 };
      const original = selector.match(/data-original="([^"]+)"/);
      return original ? loadedImages().find((image) => image.dataset.original === original[1]) : null;
    },
  };
  const window = {
    innerHeight: 180, innerWidth: 500, scrollY: 0,
    location: new URL("https://gallery.example/"),
    addEventListener() {},
    requestAnimationFrame: (callback) => frames.push(callback),
    history: { pushState(_state, _title, url) {
      history.push(url);
      window.location = new URL(url, window.location.origin);
    } },
  };
  const context = vm.createContext({
    window, document, Image, URL, URLSearchParams, AbortController,
    navigator: { connection: { saveData: true } },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key),
    },
    setTimeout() { return 1; }, clearTimeout() {},
  });
  for (const [name, source] of Object.entries(sources)) vm.runInContext(source, context, { filename: `${name}.js` });
  const paintFrame = () => frames.splice(0).forEach((callback) => callback());
  return { context, window, document, gallery, pendingImages, loadedImages, history, storage, session, paintFrame };
}

function createImageLoader(browser) {
  const data = new browser.window.DataLoader();
  data.galleryData = { gallery: { photos: { images: Array.from({ length: 40 }, (_, index) => ({
    original: `https://img.example/${index}.jpg`, preview: `https://img.example/preview-${index}.jpg`,
  })) } } };
  const loader = new browser.window.ImageLoader(browser.gallery, data);
  loader.showLoadingMessage = () => {};
  loader.hideLoadingMessage = () => {};
  loader.checkIfMoreImagesNeeded = () => {};
  loader.handleAllImagesLoaded = () => {};
  return { data, loader };
}

function finishBatch(browser) {
  let steps = 0;
  while (browser.pendingImages.length) {
    assert.ok(steps++ < 100, "图片加载应在有限步内结束");
    const image = browser.pendingImages.shift();
    if (image.onload) image.onload();
  }
}

test("随机图库多批加载后无漏图，查询当前列表不会重新排序", () => {
  for (const tag of ["all", "photos"]) {
    const browser = createBrowser();
    const { loader } = createImageLoader(browser);
    loader.filterImages(tag);
    const snapshot = loader.getCurrentImages();
    assert.equal(loader.getCurrentImages(), snapshot);
    for (let batch = 0; batch < 50 && loader.currentIndex < 40; batch++) {
      finishBatch(browser);
      loader.loadNextImages(tag);
    }
    finishBatch(browser);
    const urls = browser.loadedImages().map((image) => image.dataset.original);
    assert.equal(urls.length, 40);
    assert.equal(new Set(urls).size, 40);
    assert.deepEqual(urls, [...snapshot].map((image) => image.original));
  }
});

test("重复加载入口不并发启动批次；同分类重置后旧回调不推进新游标", () => {
  const browser = createBrowser();
  const { loader } = createImageLoader(browser);
  loader.filterImages("photos");
  const originalRequest = browser.pendingImages[0];
  const oldOnload = originalRequest.onload;
  const oldOnerror = originalRequest.onerror;
  loader.loadNextImages("photos");
  assert.equal(browser.pendingImages.length, 1);
  loader.filterImages("photos");
  oldOnload();
  oldOnerror();
  assert.equal(loader.currentIndex, 0);
  assert.equal(browser.loadedImages().length, 0);
  finishBatch(browser);
  assert.ok(loader.currentIndex > 0);
});

test("预览失败后的原图请求仍可随分类切换取消", () => {
  const browser = createBrowser();
  const { loader } = createImageLoader(browser);
  loader.filterImages("photos");
  const image = browser.pendingImages[0];
  image.onerror();
  assert.ok(loader.loadingImages.includes(image));
  loader.filterImages("all");
  assert.equal(image.src, "");
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
});

test("中文、空格及保留字符分类 URL 可恢复，筛选仅执行一次且历史不重复写入", () => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  const selected = [];
  const category = "旅行 空间?#";
  const tags = new browser.window.TagFilter((tag) => {
    selected.push(tag);
    gallery.updateUrlForTag(tag);
  });
  const buttons = ["all", category].map((tag) => ({ dataset: { tag }, style: {}, offsetTop: 0, clientHeight: 10 }));
  tags.tagContainer = { querySelectorAll: () => buttons, clientHeight: 100, scrollTo() {} };
  gallery.tagFilter = tags;
  gallery.dataLoader = { getCategories: () => [category] };
  gallery.imageLoader = { filterImages: (tag) => selected.push(tag) };
  browser.window.location = new URL(`https://gallery.example/${encodeURIComponent(category)}?fullscreen=0#anchor`);
  gallery.handleUrlParams();
  assert.deepEqual(selected, [category]);
  assert.deepEqual(browser.history, []);

  browser.window.location = new URL("https://gallery.example/?fullscreen=0#anchor");
  gallery.handleUrlParams();
  assert.deepEqual(selected, [category, "all"]);
  gallery.updateUrlForTag(category);
  assert.equal(browser.window.location.pathname, `/${encodeURIComponent(category)}`);
  assert.equal(browser.window.location.search, "?fullscreen=0");
  assert.equal(browser.window.location.hash, "#anchor");
  browser.window.location = new URL("https://gallery.example/%ZZ");
  assert.doesNotThrow(() => gallery.handleUrlParams());
});

test("初始化等待新配置，网络失败时使用旧配置且不延长缓存寿命", async () => {
  for (const successful of [true, false]) {
    const browser = createBrowser();
    const Gallery = vm.runInContext("Gallery", browser.context);
    const gallery = Object.create(Gallery.prototype);
    const oldConfig = { displayMode: "fullscreen", galleryDataMode: "static", site: { title: "old" } };
    const freshConfig = { displayMode: "fullscreen", galleryDataMode: "imgbed-api", site: { title: "new" } };
    const cached = JSON.stringify({ config: oldConfig, _cachedAt: Date.now() - 1000 });
    browser.storage.set("gallery-remote-config", cached);
    let resolveConfig;
    const applied = [];
    gallery.fetchRemoteConfig = () => new Promise((resolve) => { resolveConfig = resolve; });
    gallery.applyCachedSiteBoot = () => {};
    gallery.applyRemoteConfigToPage = () => {};
    gallery.applyRemoteConfigToDataLoader = (config) => applied.push(config);
    gallery.getUploadSettings = () => ({});
    gallery.applyBootDisplayMode = () => {};
    gallery.initSingleImageMode = async () => {};
    gallery.dataLoader = { setShuffleEnabled() {}, hasRandomApi: () => true };
    const init = gallery.init();
    assert.equal(applied.length, 0);
    resolveConfig(successful ? freshConfig : null);
    await init;
    assert.equal(applied[0].site.title, successful ? "new" : "old");
    if (!successful) assert.equal(browser.storage.get("gallery-remote-config"), cached);
  }
});

test("显式清空目录和方向可覆盖静态索引的 source 配置", () => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  gallery.dataLoader = new browser.window.DataLoader();
  gallery.dataLoader.galleryData = { source: { list_dir: "old-dir", random_orientation: "portrait" } };
  gallery.applyRemoteConfigToDataLoader({ imgbed: { listDir: "", randomOrientation: "" } });
  assert.equal(gallery.dataLoader.getConfiguredListDir(), "");
  assert.equal(gallery.dataLoader.getConfiguredRandomOrientation(), "");
});

test("没有 AbortSignal.timeout 的浏览器仍请求配置，预取结果可复用", async () => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  const config = { displayMode: "waterfall" };
  let calls = 0;
  browser.context.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return Response.json({ config });
  };
  assert.deepEqual(await gallery.fetchRemoteConfig(), config);
  assert.equal(calls, 1);

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const prefetch = inlineScripts.find((script) => script.includes("__galleryPublicConfigPromise"));
  vm.runInContext(prefetch, browser.context);
  assert.deepEqual(await gallery.fetchRemoteConfig(), config);
  assert.equal(calls, 2);
  assert.equal(browser.window.__galleryPublicConfigPromise, null);
});

test("静态索引再次筛选子目录时兼容完整路径与旧相对路径", () => {
  for (const prefix of ["foo/", ""]) {
    const browser = createBrowser();
    const data = new browser.window.DataLoader();
    data.galleryData = {
      source: { list_dir: "foo", file_route_prefix: "/file" },
      gallery: { photos: { images: [
        { original: `https://img.example/file/${prefix}photos/a.jpg` },
        { original: `https://img.example/file/${prefix}other/b.jpg` },
      ] } },
    };
    data.setRuntimeSourceConfig({ list_dir: "foo/photos" });
    const filtered = data.applyConfiguredDirFilter(data.galleryData);
    assert.equal(filtered.total_images, 1);
    assert.equal(filtered.gallery.photos.images[0].original, `https://img.example/file/${prefix}photos/a.jpg`);
  }
});

test("全屏首图直接进入显示元素，不等待额外隐藏图片下载", async (t) => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  const target = new browser.context.Image();
  const url = "https://img.example/fullscreen.jpg";
  const ready = gallery.loadImageToElement(target, url, { fetchPriority: "high" });
  const beganOnDisplayElement = browser.pendingImages[0] === target;
  assert.equal(target.classList.contains("single-image-ready"), true, "下载期间允许渐进式图片绘制");
  browser.pendingImages[0].onload();
  await ready;
  t.diagnostic(`首图加载节点数：${new Set(browser.pendingImages).size}；直接在显示元素发起：${beganOnDisplayElement}`);
  assert.equal(beganOnDisplayElement, true);
  assert.equal(browser.pendingImages.length, 1);
  assert.equal(target.fetchPriority, "high");
  assert.equal(target.onload, null);
  assert.equal(target.onerror, null);
});

test("公共样式不再通过网络字体阻塞全屏首图初始化", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.equal(/@import\s+url\([^)]*fonts\.googleapis/i.test(css), false);
});

test("全屏随机首图仍保留目录和方向筛选，直接显示返回的图片", async () => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  gallery.dataLoader = new browser.window.DataLoader();
  gallery.dataLoader.setRuntimeSourceConfig({
    base_url: "https://img.example", random_endpoint: "/random",
    list_dir: "wallpapers", random_orientation: "landscape",
  });
  gallery.singleImageElement = new browser.context.Image();
  gallery.singleImageStage = browser.document.createElement("div");
  gallery.singleImageStage.style.setProperty = function (key, value) { this[key] = value; };
  gallery.setupFullscreenUploadUi = () => {};
  let finished = false;
  gallery.hideLoading = () => { finished = true; };
  const requests = [];
  browser.context.fetch = async (url) => {
    requests.push(new URL(url));
    return new Response("/file/wallpapers/photo.jpg", { headers: { "Content-Type": "text/plain" } });
  };
  const ready = gallery.initSingleImageMode();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("dir"), "wallpapers");
  assert.equal(requests[0].searchParams.get("orientation"), "landscape");
  assert.equal(gallery.singleImageElement.src, "https://img.example/file/wallpapers/photo.jpg");
  assert.equal(finished, false);
  gallery.singleImageElement.onload();
  await ready;
  assert.equal(finished, true);
  assert.equal(browser.pendingImages.length, 1);
  assert.equal(browser.document.head.children.length, 0);
  assert.equal(gallery.singleImageStage.style["--single-image-backdrop"], undefined);
  browser.paintFrame();
  assert.equal(gallery.singleImageStage.style["--single-image-backdrop"], undefined);
  browser.paintFrame();
  assert.equal(gallery.singleImageStage.style["--single-image-backdrop"], 'url("https://img.example/file/wallpapers/photo.jpg")');
});

test("全屏预览图加载失败后仍回退原图，失败回调不会残留", async () => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  gallery.singleImageElement = new browser.context.Image();
  gallery.singleImageStage = browser.document.createElement("div");
  gallery.singleImageStage.style.setProperty = function (key, value) { this[key] = value; };
  gallery.setupFullscreenUploadUi = () => {};
  gallery.hideLoading = () => {};
  gallery.getSingleImageData = async () => ({
    preview: "https://img.example/preview.jpg", original: "https://img.example/original.jpg",
  });
  gallery.preloadAndSwapSingleImageOriginal = () => assert.fail("已经显示原图，不应再次预加载");
  const ready = gallery.initSingleImageMode();
  await new Promise((resolve) => setImmediate(resolve));
  gallery.singleImageElement.onerror();
  assert.equal(gallery.singleImageElement.classList.contains("single-image-ready"), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gallery.singleImageElement.src, "https://img.example/original.jpg");
  gallery.singleImageElement.onload();
  await ready;
  assert.equal(gallery.singleImageElement.onerror, null);
  assert.equal(gallery.singleImageElement.classList.contains("single-image-ready"), true);
});

test("瀑布流仍加载原有字体，重复初始化不重复添加字体请求", async () => {
  const browser = createBrowser();
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  browser.window.AutoScroll = function () {};
  await gallery.ensureWaterfallDependencies();
  await gallery.ensureWaterfallDependencies();
  const fonts = browser.document.head.children.filter((element) => element.rel === "stylesheet");
  assert.equal(fonts.length, 1);
  assert.equal(new URL(fonts[0].href).hostname, "fonts.googleapis.com");
});

function createFullscreenGallery(browser) {
  const Gallery = vm.runInContext("Gallery", browser.context);
  const gallery = Object.create(Gallery.prototype);
  gallery.singleImageMode = true;
  gallery.settings = { shuffle: true };
  gallery.dataLoader = new browser.window.DataLoader();
  gallery.dataLoader.setRuntimeSourceConfig({ base_url: "https://img.example", list_dir: "wallpapers" });
  gallery.singleImageElement = new browser.context.Image();
  gallery.singleImageElement.id = "single-image";
  gallery.singleImageElement.alt = "Gallery Image";
  gallery.singleImageElement.className = "single-image-ready";
  gallery.singleImageStage = browser.document.createElement("div");
  gallery.singleImageStage.style.setProperty = function (key, value) { this[key] = value; };
  gallery.singleImageStage.appendChild(gallery.singleImageElement);
  gallery.setupFullscreenUploadUi = () => {};
  gallery.readyCount = 0;
  gallery.hideLoading = () => gallery.readyCount++;
  return gallery;
}

test("下一张预取完成后，刷新可跳过随机接口，缓存只消费一次", async (t) => {
  const browser = createBrowser();
  browser.context.navigator.connection.saveData = false;
  let randomRequests = 0;
  browser.context.fetch = async () => {
    randomRequests++;
    return new Response("/file/wallpapers/next.jpg");
  };
  const gallery = createFullscreenGallery(browser);
  gallery.prefetchNextSingleImage();
  gallery.prefetchNextSingleImage();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(randomRequests, 1);
  assert.equal(browser.pendingImages.length, 1);
  assert.equal(browser.pendingImages[0].fetchPriority, "low");
  assert.equal(gallery.dataLoader.takePrefetchedRandomImage(), null, "图片下载完成前不能发布预取结果");
  browser.pendingImages[0].onload();
  const nextVisit = createFullscreenGallery(browser);
  const image = await nextVisit.getSingleImageData();
  assert.equal(image.original, "https://img.example/file/wallpapers/next.jpg");
  assert.equal(image.prefetched, true);
  assert.equal(randomRequests, 1);
  await nextVisit.getSingleImageData();
  assert.equal(randomRequests, 2);
  t.diagnostic("命中预取的刷新：前台随机接口请求数为 0，条目消费后不会固定重复展示。");
});

test("预取结果在目录、方向变化或过期后失效", () => {
  for (const change of ["dir", "orientation", "expired"]) {
    const browser = createBrowser();
    const gallery = createFullscreenGallery(browser);
    gallery.dataLoader.cachePrefetchedRandomImage({ original: "https://img.example/a.jpg", preview: "https://img.example/a.jpg" });
    if (change === "expired") {
      const cached = JSON.parse(browser.session.get("gallery-next-random-image"));
      cached.createdAt -= 61000;
      browser.session.set("gallery-next-random-image", JSON.stringify(cached));
    } else {
      gallery.dataLoader.setRuntimeSourceConfig({
        base_url: "https://img.example", list_dir: change === "dir" ? "new-dir" : "wallpapers",
        random_orientation: change === "orientation" ? "portrait" : "",
      });
    }
    assert.equal(gallery.dataLoader.takePrefetchedRandomImage(), null);
    assert.equal(browser.session.size, 0);
  }
});

test("省流量、弱网及后台页面不预取，离开页面会取消进行中的预取", async () => {
  const browser = createBrowser();
  const gallery = createFullscreenGallery(browser);
  let calls = 0;
  browser.context.fetch = async () => { calls++; return new Response("/file/wallpapers/a.jpg"); };
  gallery.prefetchNextSingleImage();
  browser.context.navigator.connection = { effectiveType: "3g" };
  gallery.prefetchNextSingleImage();
  browser.context.navigator.connection = {};
  browser.document.visibilityState = "hidden";
  gallery.prefetchNextSingleImage();
  assert.equal(calls, 0);
  browser.document.visibilityState = "visible";
  gallery.prefetchNextSingleImage();
  await new Promise((resolve) => setImmediate(resolve));
  const image = browser.pendingImages[0];
  gallery.cancelNextImagePreload();
  assert.equal(image.src, "");
  assert.equal(image.onload, null);
  assert.equal(browser.session.size, 0);
});

test("已删除的预取图片会重新实时选图，不停留在错误页面", async () => {
  const browser = createBrowser();
  const gallery = createFullscreenGallery(browser);
  gallery.dataLoader.cachePrefetchedRandomImage({ original: "https://img.example/deleted.jpg", preview: "https://img.example/deleted.jpg" });
  let requests = 0;
  browser.context.fetch = async () => { requests++; return new Response("/file/wallpapers/fresh.jpg"); };
  const ready = gallery.initSingleImageMode();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 0);
  gallery.singleImageElement.onerror();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(gallery.singleImageElement.src, "https://img.example/file/wallpapers/fresh.jpg");
  gallery.singleImageElement.onload();
  await ready;
  assert.equal(gallery.readyCount, 1);
  assert.equal(gallery.singleImageStage.classList.contains("empty"), false);
});

test("预取过程中页面进入后台时，延迟到达的完成回调不能发布缓存", async () => {
  const browser = createBrowser();
  browser.context.navigator.connection.saveData = false;
  const gallery = createFullscreenGallery(browser);
  browser.context.fetch = async () => new Response("/file/wallpapers/next.jpg");
  gallery.prefetchNextSingleImage();
  await new Promise((resolve) => setImmediate(resolve));
  const completed = browser.pendingImages[0].onload;
  browser.document.visibilityState = "hidden";
  gallery.cancelNextImagePreload();
  completed();
  assert.equal(browser.session.size, 0);
  assert.equal(gallery.nextImagePreload, null);
});

test("原图升级复用已经下载的图片元素，过期升级不会覆盖后来显示的图片", () => {
  for (const changed of [false, true]) {
    const browser = createBrowser();
    const gallery = createFullscreenGallery(browser);
    const preview = gallery.singleImageElement;
    preview.src = "https://img.example/preview.jpg";
    browser.pendingImages.length = 0;
    gallery.preloadAndSwapSingleImageOriginal("https://img.example/original.jpg");
    const original = browser.pendingImages[0];
    if (changed) preview.src = "https://img.example/uploaded.jpg";
    original.onload();
    if (changed) {
      assert.equal(gallery.singleImageElement, preview);
      assert.equal(preview.src, "https://img.example/uploaded.jpg");
    } else {
      assert.equal(gallery.singleImageElement, original);
      assert.equal(gallery.singleImageStage.children[0], original);
      assert.equal(original.id, "single-image");
      assert.equal(original.alt, "Gallery Image");
      assert.equal(browser.pendingImages.length, 1);
    }
  }
});
