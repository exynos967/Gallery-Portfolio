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
  const elements = new Map();
  const history = [];
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.offsetHeight = 0;
      this.classList = { add() {}, remove() {}, contains() { return false; } };
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
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
    setTimeout() { return 1; }, clearTimeout() {},
  });
  for (const [name, source] of Object.entries(sources)) vm.runInContext(source, context, { filename: `${name}.js` });
  return { context, window, document, gallery, pendingImages, loadedImages, history, storage };
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
