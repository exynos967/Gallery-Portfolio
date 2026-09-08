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
