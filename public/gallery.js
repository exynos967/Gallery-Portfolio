// 主画廊模块
class Gallery {
    constructor() {
        this.settings = {
            fullscreen: true,
            shuffle: true,
        };
        this.uploadSettings = {
            enabled: false,
            modalTitle: '上传图片',
            buttonText: '上传图片',
            description: '请填写图片描述并选择图片后上传。',
        };
        this.remoteConfig = null;
        this.dataLoader = new DataLoader();
        this.autoScroll = null;
        this.tagFilter = null;
        this.imageLoader = null;
        this.isPageLoading = true;
        this.isRandomImageLoading = false;
        this.singleImageMode = false;

        this.fullscreenToggleBtn = null;
        this.shuffleToggleBtn = null;
        this.randomImageBtn = null;

        this.singleImageStage = document.getElementById('single-image-stage');
        this.singleImageElement = document.getElementById('single-image');
        this.loadingElement = document.getElementById('loading');

        this.fullscreenUploadBtn = document.getElementById('fullscreen-upload-btn');
        this.fullscreenUploadBtnText = document.getElementById('fullscreen-upload-btn-text');
        this.uploadModal = document.getElementById('upload-modal');
        this.uploadForm = document.getElementById('upload-form');
        this.uploadTitleElement = document.getElementById('upload-modal-title');
        this.uploadDescriptionElement = document.getElementById('upload-modal-description');
        this.uploadTargetDirElement = document.getElementById('upload-folder-label');
        this.uploadDescriptionInput = document.getElementById('upload-user-description');
        this.uploadFileInput = document.getElementById('upload-file-input');
        this.uploadStatusElement = document.getElementById('upload-feedback');
        this.uploadSubmitBtn = document.getElementById('upload-submit-btn');
        this.uploadCancelBtn = document.getElementById('upload-cancel-btn');
        this.uploadUiInitialized = false;

        document.body.classList.add('app-booting');

        this.init();
    }

    async init() {
        window.addEventListener('load', () => {
            this.isPageLoading = false;
        });

        window.addEventListener('popstate', () => {
            if (this.singleImageMode) return;
            setTimeout(() => this.handleUrlParams(), 0);
        });

        this.remoteConfig = await this.fetchRemoteConfig();
        this.applyRemoteConfigToDataLoader(this.remoteConfig);
        this.settings = this.getInitialSettings(this.remoteConfig);
        this.uploadSettings = this.getUploadSettings(this.remoteConfig);
        this.applyBootDisplayMode(this.settings.fullscreen);
        this.dataLoader.setShuffleEnabled(this.settings.shuffle);

        await this.dataLoader.loadGalleryData();

        if (this.settings.fullscreen) {
            this.singleImageMode = true;
            await this.initSingleImageMode();
            return;
        }

        this.autoScroll = new AutoScroll();
        this.initComponents();
        this.applyFullscreenMode(false);
        this.setupActionButtons();
        this.markAppReady();
        this.autoScroll.setupScrollButtonVisibility();
        this.handleUrlParams();
        this.loadInitialImages();
    }

    initComponents() {
        const galleryElement = document.getElementById('gallery');

        this.imageLoader = new ImageLoader(galleryElement, this.dataLoader);

        this.tagFilter = new TagFilter((tag) => {
            this.imageLoader.filterImages(tag);
            this.updateUrlForTag(tag);
        });

        const categories = this.dataLoader.getCategories();
        this.tagFilter.createTagFilter(categories);

        this.imageLoader.setupModalEvents();
        this.imageLoader.setGalleryMarginTop();
    }

    async initSingleImageMode() {
        document.body.classList.add('single-image-mode');
        this.setupFullscreenUploadUi();
        const stage = this.ensureSingleImageStage();
        const imageData = await this.getSingleImageData();

        if (!imageData) {
            stage.classList.add('empty');
            stage.textContent = 'No image';
            this.hideLoading();
            return;
        }

        // 单图模式优先加载 preview，首屏更快，再后台无感升级到原图
        const previewUrl = imageData.preview || imageData.original;
        const originalUrl = imageData.original || imageData.preview;
        let displayedUrl = '';

        try {
            await this.loadImageToElement(this.singleImageElement, previewUrl, { fetchPriority: 'high' });
            displayedUrl = previewUrl;
        } catch (error) {
            if (!originalUrl || originalUrl === previewUrl) {
                console.error('全屏单图加载失败:', error);
                stage.classList.add('empty');
                stage.textContent = 'Image load failed';
                this.hideLoading();
                return;
            }

            try {
                await this.loadImageToElement(this.singleImageElement, originalUrl, { fetchPriority: 'high' });
                displayedUrl = originalUrl;
            } catch (fallbackError) {
                console.error('全屏单图加载失败（含回退）:', fallbackError);
                stage.classList.add('empty');
                stage.textContent = 'Image load failed';
                this.hideLoading();
                return;
            }
        }

        stage.classList.remove('empty');
        this.hideLoading();

        if (originalUrl && displayedUrl && originalUrl !== displayedUrl) {
            this.preloadAndSwapSingleImageOriginal(originalUrl);
        }
    }

    ensureSingleImageStage() {
        if (this.singleImageStage && this.singleImageElement) {
            return this.singleImageStage;
        }

        const stage = document.createElement('div');
        stage.id = 'single-image-stage';
        stage.className = 'single-image-stage';

        const image = document.createElement('img');
        image.id = 'single-image';
        image.alt = 'Gallery Image';

        stage.appendChild(image);
        document.body.appendChild(stage);

        this.singleImageStage = stage;
        this.singleImageElement = image;
        return stage;
    }

    async getSingleImageData() {
        if (this.dataLoader.hasRandomApi()) {
            try {
                return await this.dataLoader.fetchRandomImage({
                    orientation: 'auto',
                });
            } catch (error) {
                console.warn('随机图接口失败，回退本地数据:', error);
            }
        }

        const allImages = this.dataLoader.getAllImages();
        if (!allImages.length) return null;

        if (this.settings.shuffle) {
            const index = Math.floor(Math.random() * allImages.length);
            return allImages[index];
        }

        return allImages[0];
    }

    loadImageToElement(imageElement, imageUrl, options = {}) {
        return new Promise((resolve, reject) => {
            if (!imageUrl) {
                reject(new Error('image url is empty'));
                return;
            }

            const loader = new Image();
            try {
                loader.decoding = 'async';
            } catch {
                // ignore unsupported browsers
            }
            try {
                if (options.fetchPriority) {
                    loader.fetchPriority = options.fetchPriority;
                }
            } catch {
                // ignore unsupported browsers
            }
            loader.onload = () => {
                imageElement.src = imageUrl;
                resolve();
            };
            loader.onerror = () => {
                reject(new Error(`failed to load image: ${imageUrl}`));
            };
            loader.src = imageUrl;
        });
    }

    preloadAndSwapSingleImageOriginal(originalUrl) {
        const loader = new Image();
        try {
            loader.decoding = 'async';
        } catch {
            // ignore unsupported browsers
        }
        try {
            loader.fetchPriority = 'low';
        } catch {
            // ignore unsupported browsers
        }

        loader.onload = () => {
            if (!this.singleImageMode || !this.singleImageElement) {
                return;
            }
            this.singleImageElement.src = originalUrl;
        };

        loader.onerror = () => {
            // 保持当前 preview，无需打断用户
        };

        loader.src = originalUrl;
    }

    hideLoading() {
        if (this.loadingElement) {
            this.loadingElement.classList.add('hidden');
        }
        this.markAppReady();
    }

    applyBootDisplayMode(isFullscreen) {
        const root = document.documentElement;
        root.classList.toggle('boot-fullscreen', Boolean(isFullscreen));
        root.classList.toggle('boot-waterfall', !Boolean(isFullscreen));
    }

    markAppReady() {
        document.body.classList.remove('app-booting');
        const root = document.documentElement;
        root.classList.remove('boot-fullscreen');
        root.classList.remove('boot-waterfall');
    }

    normalizeDirPath(input) {
        return String(input || '').trim().replace(/^\/+|\/+$/g, '');
    }

    getUploadTargetDir() {
        const fromRemoteConfig = this.normalizeDirPath(
            this.remoteConfig?.imgbed?.listDir || this.remoteConfig?.imgbed?.list_dir || ''
        );
        if (fromRemoteConfig) return fromRemoteConfig;

        const sourceInfo = this.dataLoader.getSourceInfo?.() || {};
        return this.normalizeDirPath(sourceInfo.list_dir || sourceInfo.listDir || '');
    }

    getUploadSettings(remoteConfig = null) {
        const uploadConfig = remoteConfig?.publicUpload || {};
        const normalizeText = (value, fallback, maxLength) => {
            const text = String(value ?? '').trim();
            const safeFallback = String(fallback ?? '').trim();
            const resolved = text || safeFallback;
            return maxLength ? resolved.slice(0, maxLength) : resolved;
        };

        return {
            enabled: uploadConfig.enabled === true,
            modalTitle: normalizeText(uploadConfig.modalTitle, '上传图片', 80),
            buttonText: normalizeText(uploadConfig.buttonText, '上传图片', 24),
            description: normalizeText(
                uploadConfig.description,
                '请填写图片描述并选择图片后上传。',
                500
            ),
        };
    }

    setupFullscreenUploadUi() {
        if (!this.fullscreenUploadBtn || !this.uploadModal) {
            return;
        }

        const canUseUpload = this.uploadSettings.enabled === true;
        this.fullscreenUploadBtn.classList.toggle('upload-hidden', !canUseUpload);
        if (!canUseUpload) {
            this.closeUploadModal();
            return;
        }

        if (this.fullscreenUploadBtnText) {
            this.fullscreenUploadBtnText.textContent = this.uploadSettings.buttonText || '上传图片';
        }
        if (this.uploadTitleElement) {
            this.uploadTitleElement.textContent = this.uploadSettings.modalTitle || '上传图片';
        }
        if (this.uploadDescriptionElement) {
            this.uploadDescriptionElement.textContent =
                this.uploadSettings.description || '请填写图片描述并选择图片后上传。';
        }
        if (this.uploadTargetDirElement) {
            const targetDir = this.getUploadTargetDir();
            this.uploadTargetDirElement.textContent = targetDir ? `/${targetDir}` : '/';
        }

        if (this.uploadUiInitialized) return;
        this.uploadUiInitialized = true;

        this.fullscreenUploadBtn.addEventListener('click', () => {
            this.openUploadModal();
        });

        if (this.uploadCancelBtn) {
            this.uploadCancelBtn.addEventListener('click', () => {
                this.closeUploadModal();
            });
        }

        if (this.uploadModal) {
            this.uploadModal.addEventListener('click', (event) => {
                if (event.target === this.uploadModal) {
                    this.closeUploadModal();
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.uploadModal && !this.uploadModal.classList.contains('upload-hidden')) {
                this.closeUploadModal();
            }
        });

        if (this.uploadForm) {
            this.uploadForm.addEventListener('submit', (event) => {
                event.preventDefault();
                this.handleUploadSubmit();
            });
        }
    }

    openUploadModal() {
        if (!this.uploadModal) return;
        if (this.uploadTargetDirElement) {
            const targetDir = this.getUploadTargetDir();
            this.uploadTargetDirElement.textContent = targetDir ? `/${targetDir}` : '/';
        }
        this.setUploadStatus('', 'info');
        this.uploadModal.classList.remove('upload-hidden');
        if (this.uploadDescriptionInput) {
            this.uploadDescriptionInput.focus();
        }
    }

    closeUploadModal() {
        if (!this.uploadModal) return;
        this.uploadModal.classList.add('upload-hidden');
        if (this.uploadForm) {
            this.uploadForm.reset();
        }
        this.setUploadStatus('', 'info');
    }

    setUploadStatus(message, level = 'info') {
        if (!this.uploadStatusElement) return;
        this.uploadStatusElement.textContent = message;
        this.uploadStatusElement.dataset.level = level;
    }

    async handleUploadSubmit() {
        const file = this.uploadFileInput?.files?.[0];
        const description = String(this.uploadDescriptionInput?.value || '').trim().slice(0, 500);

        if (!file) {
            this.setUploadStatus('请先选择一张图片。', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', file, file.name);
        formData.append('description', description);

        if (this.uploadSubmitBtn) {
            this.uploadSubmitBtn.disabled = true;
            this.uploadSubmitBtn.textContent = '上传中...';
        }
        this.setUploadStatus('正在上传，请稍候...', 'info');

        try {
            const response = await fetch('/api/public-upload', {
                method: 'POST',
                body: formData,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.message || `上传失败（HTTP ${response.status}）`);
            }

            const uploadedUrl = payload?.data?.url || '';
            if (uploadedUrl && this.singleImageElement) {
                this.singleImageElement.src = uploadedUrl;
            }

            this.setUploadStatus('上传成功，感谢你的投稿。', 'success');
            setTimeout(() => {
                this.closeUploadModal();
            }, 900);
        } catch (error) {
            this.setUploadStatus(`上传失败：${error.message}`, 'error');
        } finally {
            if (this.uploadSubmitBtn) {
                this.uploadSubmitBtn.disabled = false;
                this.uploadSubmitBtn.textContent = '开始上传';
            }
        }
    }

    handleUrlParams() {
        if (!this.tagFilter || typeof this.tagFilter.selectTagByValue !== 'function') {
            return;
        }

        const path = window.location.pathname;
        const tagFromUrl = path.substring(1);

        if (tagFromUrl && tagFromUrl !== '') {
            const categories = this.dataLoader.getCategories();
            if (categories.includes(tagFromUrl)) {
                this.tagFilter.selectTagByValue(tagFromUrl);
                this.imageLoader.filterImages(tagFromUrl);
            } else if (this.tagFilter.getCurrentTag() !== 'all') {
                this.tagFilter.selectTagByValue('all');
                this.imageLoader.filterImages('all');
            }
        } else if (this.tagFilter.getCurrentTag() !== 'all') {
            this.tagFilter.selectTagByValue('all');
            this.imageLoader.filterImages('all');
        }
    }

    updateUrlForTag(tag) {
        const searchAndHash = `${window.location.search}${window.location.hash}`;

        if (tag === 'all') {
            const targetUrl = `/${searchAndHash}`;
            if (`${window.location.pathname}${searchAndHash}` !== targetUrl) {
                window.history.pushState({}, '', targetUrl);
            }
        } else {
            const newUrl = `/${tag}${searchAndHash}`;
            if (`${window.location.pathname}${searchAndHash}` !== newUrl) {
                window.history.pushState({}, '', newUrl);
            }
        }
    }

    loadInitialImages() {
        if (this.tagFilter.getCurrentTag() === 'all') {
            this.imageLoader.filterImages('all');
        }
        this.imageLoader.updateColumns();

        setTimeout(() => {
            this.imageLoader.checkIfMoreImagesNeeded();
        }, 500);
    }

    getInitialSettings(remoteConfig = null) {
        const params = new URLSearchParams(window.location.search);
        const storedShuffle = localStorage.getItem('gallery-shuffle-mode');
        const displayMode = String(remoteConfig?.displayMode || '').toLowerCase();
        const defaultFullscreen = displayMode === 'waterfall' ? false : true;
        const defaultShuffle = remoteConfig?.shuffleEnabled ?? true;
        const fullscreenFromQuery = this.parseBooleanOption(params.get('fullscreen'), null, null);

        return {
            fullscreen: fullscreenFromQuery === null ? defaultFullscreen : fullscreenFromQuery,
            shuffle: this.parseBooleanOption(params.get('shuffle'), storedShuffle, defaultShuffle),
        };
    }

    parseBooleanOption(queryValue, storedValue, defaultValue) {
        const parseValue = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const normalized = String(value).trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
            return null;
        };

        const fromQuery = parseValue(queryValue);
        if (fromQuery !== null) return fromQuery;

        const fromStorage = parseValue(storedValue);
        if (fromStorage !== null) return fromStorage;

        return defaultValue;
    }

    setupActionButtons() {
        if (this.singleImageMode) return;

        this.fullscreenToggleBtn = document.getElementById('fullscreen-toggle');
        this.shuffleToggleBtn = document.getElementById('shuffle-toggle');
        this.randomImageBtn = document.getElementById('random-image-btn');

        if (this.fullscreenToggleBtn) {
            this.fullscreenToggleBtn.addEventListener('click', () => {
                this.applyFullscreenMode(true);
            });
        }

        if (this.shuffleToggleBtn) {
            this.shuffleToggleBtn.addEventListener('click', () => {
                this.toggleShuffleMode();
            });
        }

        if (this.randomImageBtn) {
            if (this.dataLoader.hasRandomApi()) {
                this.randomImageBtn.addEventListener('click', () => {
                    this.openRandomImage();
                });
            } else {
                this.randomImageBtn.style.display = 'none';
            }
        }

        this.updateActionButtons();
    }

    updateActionButtons() {
        if (this.singleImageMode) return;

        if (this.fullscreenToggleBtn) {
            this.fullscreenToggleBtn.classList.toggle('active', false);
            this.fullscreenToggleBtn.setAttribute('aria-label', '开启全屏模式');
            this.fullscreenToggleBtn.textContent = '⛶';
        }

        if (this.shuffleToggleBtn) {
            this.shuffleToggleBtn.classList.toggle('active', this.settings.shuffle);
            this.shuffleToggleBtn.setAttribute(
                'aria-label',
                this.settings.shuffle ? '关闭随机排序' : '开启随机排序'
            );
        }
    }

    applyFullscreenMode(enabled) {
        const fullscreen = Boolean(enabled);
        this.settings.fullscreen = fullscreen;

        if (fullscreen) {
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set('fullscreen', '1');
            window.location.href = nextUrl.toString();
            return;
        }

        document.body.classList.remove('single-image-mode');
        this.closeUploadModal();
        if (this.fullscreenUploadBtn) {
            this.fullscreenUploadBtn.classList.add('upload-hidden');
        }
        if (this.imageLoader) {
            this.imageLoader.setGalleryMarginTop();
            this.imageLoader.updateColumns();
        }

        this.updateActionButtons();
    }

    toggleShuffleMode() {
        if (this.singleImageMode) return;

        this.settings.shuffle = !this.settings.shuffle;
        this.dataLoader.setShuffleEnabled(this.settings.shuffle);
        localStorage.setItem('gallery-shuffle-mode', String(this.settings.shuffle));

        if (this.tagFilter && this.imageLoader) {
            this.imageLoader.filterImages(this.tagFilter.getCurrentTag());
            this.imageLoader.updateColumns();
        }

        this.updateActionButtons();
    }

    async openRandomImage() {
        if (this.singleImageMode) return;
        if (!this.imageLoader || this.isRandomImageLoading) return;

        this.isRandomImageLoading = true;

        if (this.randomImageBtn) {
            this.randomImageBtn.disabled = true;
            this.randomImageBtn.textContent = '⏳';
        }

        try {
            const randomImage = await this.dataLoader.fetchRandomImage();
            this.imageLoader.openModal(randomImage.original, randomImage.preview);
        } catch (error) {
            console.error('获取随机图失败:', error);
            alert(`获取随机图失败：${error.message}`);
        } finally {
            this.isRandomImageLoading = false;
            if (this.randomImageBtn) {
                this.randomImageBtn.disabled = false;
                this.randomImageBtn.textContent = '🎲';
            }
        }
    }

    async fetchRemoteConfig() {
        try {
            const response = await fetch('/api/public-config', {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            return payload?.config || null;
        } catch (error) {
            console.warn('获取远端配置失败，使用本地默认配置:', error);
            return null;
        }
    }

    applyRemoteConfigToDataLoader(remoteConfig) {
        if (!remoteConfig || typeof remoteConfig !== 'object') {
            return;
        }

        if (remoteConfig.galleryIndexUrl) {
            this.dataLoader.setGalleryIndexUrl(remoteConfig.galleryIndexUrl);
        }
        this.dataLoader.setGalleryDataMode(remoteConfig.galleryDataMode || 'static');

        if (remoteConfig.galleryDataApiUrl) {
            this.dataLoader.setGalleryDataApiUrl(remoteConfig.galleryDataApiUrl);
        }

        const imgbedConfig = remoteConfig.imgbed || {};
        const runtimeSource = { type: 'imgbed' };

        const baseUrl = String(imgbedConfig.baseUrl || imgbedConfig.base_url || '').trim();
        const randomEndpoint = String(imgbedConfig.randomEndpoint || imgbedConfig.random_endpoint || '').trim();
        const listEndpoint = String(imgbedConfig.listEndpoint || imgbedConfig.list_endpoint || '').trim();
        const fileRoutePrefix = String(imgbedConfig.fileRoutePrefix || imgbedConfig.file_route_prefix || '').trim();
        const listDir = String(imgbedConfig.listDir || imgbedConfig.list_dir || '').trim();
        const previewDir = String(imgbedConfig.previewDir || imgbedConfig.preview_dir || '').trim();

        if (baseUrl) runtimeSource.base_url = baseUrl;
        if (randomEndpoint) runtimeSource.random_endpoint = randomEndpoint;
        if (listEndpoint) runtimeSource.list_endpoint = listEndpoint;
        if (fileRoutePrefix) runtimeSource.file_route_prefix = fileRoutePrefix;
        if (listDir) runtimeSource.list_dir = listDir;
        if (previewDir) runtimeSource.preview_dir = previewDir;

        const hasImgBedOverride = Object.keys(runtimeSource).length > 1;

        if (hasImgBedOverride) {
            this.dataLoader.setRuntimeSourceConfig(runtimeSource);
        }
    }
}

// 页面加载完成后初始化画廊
document.addEventListener('DOMContentLoaded', () => {
    window.gallery = new Gallery();
});
