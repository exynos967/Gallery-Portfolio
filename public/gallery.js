// 主画廊模块
class Gallery {
    constructor() {
        this.settings = {
            fullscreen: true,
            shuffle: true,
        };
        this.remoteConfig = null;
        this.dataLoader = new DataLoader();
        this.autoScroll = new AutoScroll();
        this.tagFilter = null;
        this.imageLoader = null;
        this.isPageLoading = true;
        this.lastWidth = window.innerWidth;
        this.isRandomImageLoading = false;
        this.fullscreenToggleBtn = null;
        this.shuffleToggleBtn = null;
        this.randomImageBtn = null;

        this.init();
    }

    async init() {
        // 等待页面加载完成
        window.addEventListener('load', () => {
            this.isPageLoading = false;
        });

        // 监听浏览器前进后退按钮
        window.addEventListener('popstate', () => {
            // 确保 tagFilter 初始化后再处理 URL
            setTimeout(() => this.handleUrlParams(), 0);
        });

        // 加载远端配置（若可用）
        this.remoteConfig = await this.fetchRemoteConfig();
        this.applyRemoteConfigToDataLoader(this.remoteConfig);
        this.settings = this.getInitialSettings(this.remoteConfig);
        this.dataLoader.setShuffleEnabled(this.settings.shuffle);

        // 加载图片数据
        await this.dataLoader.loadGalleryData();

        // 初始化组件（包括 tagFilter）
        this.initComponents();

        // 应用显示设置（全屏 / 随机排序）
        this.applyFullscreenMode(this.settings.fullscreen, false);
        this.dataLoader.setShuffleEnabled(this.settings.shuffle);

        // 初始化功能按钮
        this.setupActionButtons();

        // 设置自动滚动按钮显示逻辑
        this.autoScroll.setupScrollButtonVisibility();

        // 处理 URL 参数（此时 tagFilter 已准备好）
        this.handleUrlParams();

        // 初始加载
        this.loadInitialImages();
    }

    initComponents() {
        const galleryElement = document.getElementById('gallery');

        // 初始化图片加载器
        this.imageLoader = new ImageLoader(galleryElement, this.dataLoader);

        // 初始化标签筛选器
        this.tagFilter = new TagFilter((tag) => {
            this.imageLoader.filterImages(tag);
            this.updateUrlForTag(tag);
        });

        // 创建标签筛选器
        const categories = this.dataLoader.getCategories();
        this.tagFilter.createTagFilter(categories);

        // 设置模态窗口事件
        this.imageLoader.setupModalEvents();

        // 设置gallery的margin-top
        this.imageLoader.setGalleryMarginTop();
    }

    // 处理URL参数
    handleUrlParams() {
        if (!this.tagFilter || typeof this.tagFilter.selectTagByValue !== 'function') {
            console.warn('tagFilter 尚未初始化，跳过 handleUrlParams');
            return;
        }

        const path = window.location.pathname;
        const tagFromUrl = path.substring(1); // 移除开头的斜杠

        console.log('处理URL参数:', { path, tagFromUrl });

        if (tagFromUrl && tagFromUrl !== '') {
            const categories = this.dataLoader.getCategories();
            console.log('可用标签:', categories);

            if (categories.includes(tagFromUrl)) {
                console.log('找到匹配的标签:', tagFromUrl);
                this.tagFilter.selectTagByValue(tagFromUrl);
                this.imageLoader.filterImages(tagFromUrl);
            } else {
                console.log('标签不存在:', tagFromUrl);
                if (this.tagFilter.getCurrentTag() !== 'all') {
                    this.tagFilter.selectTagByValue('all');
                    this.imageLoader.filterImages('all');
                }
            }
        } else {
            console.log('URL中没有标签参数，选择All标签');
            if (this.tagFilter.getCurrentTag() !== 'all') {
                this.tagFilter.selectTagByValue('all');
                this.imageLoader.filterImages('all');
            }
        }
    }

    // 更新URL
    updateUrlForTag(tag) {
        console.log('更新URL为标签:', tag);
        const searchAndHash = `${window.location.search}${window.location.hash}`;

        if (tag === 'all') {
            const targetUrl = `/${searchAndHash}`;
            if (`${window.location.pathname}${searchAndHash}` !== targetUrl) {
                console.log('移除URL中的标签参数');
                window.history.pushState({}, '', targetUrl);
            }
        } else {
            const newUrl = `/${tag}${searchAndHash}`;
            if (`${window.location.pathname}${searchAndHash}` !== newUrl) {
                console.log('更新URL为:', newUrl);
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
        const storedFullscreen = localStorage.getItem('gallery-fullscreen-mode');
        const storedShuffle = localStorage.getItem('gallery-shuffle-mode');
        const displayMode = String(remoteConfig?.displayMode || '').toLowerCase();
        const defaultFullscreen = displayMode === 'waterfall' ? false : true;
        const defaultShuffle = remoteConfig?.shuffleEnabled ?? true;

        return {
            fullscreen: this.parseBooleanOption(params.get('fullscreen'), storedFullscreen, defaultFullscreen),
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
        this.fullscreenToggleBtn = document.getElementById('fullscreen-toggle');
        this.shuffleToggleBtn = document.getElementById('shuffle-toggle');
        this.randomImageBtn = document.getElementById('random-image-btn');

        if (this.fullscreenToggleBtn) {
            this.fullscreenToggleBtn.addEventListener('click', () => {
                this.applyFullscreenMode(!this.settings.fullscreen, true);
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
        if (this.fullscreenToggleBtn) {
            this.fullscreenToggleBtn.classList.toggle('active', this.settings.fullscreen);
            this.fullscreenToggleBtn.setAttribute(
                'aria-label',
                this.settings.fullscreen ? '退出全屏模式' : '开启全屏模式'
            );
            this.fullscreenToggleBtn.textContent = this.settings.fullscreen ? '🗗' : '⛶';
        }

        if (this.shuffleToggleBtn) {
            this.shuffleToggleBtn.classList.toggle('active', this.settings.shuffle);
            this.shuffleToggleBtn.setAttribute(
                'aria-label',
                this.settings.shuffle ? '关闭随机排序' : '开启随机排序'
            );
        }
    }

    applyFullscreenMode(enabled, persist = true) {
        this.settings.fullscreen = Boolean(enabled);
        document.body.classList.toggle('fullscreen-mode', this.settings.fullscreen);

        if (persist) {
            localStorage.setItem('gallery-fullscreen-mode', String(this.settings.fullscreen));
        }

        if (this.imageLoader) {
            this.imageLoader.setGalleryMarginTop();
            this.imageLoader.updateColumns();
        }

        this.updateActionButtons();
    }

    toggleShuffleMode() {
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
        if (!this.imageLoader || this.isRandomImageLoading) {
            return;
        }

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
        const runtimeSource = {
            type: 'imgbed',
            base_url: imgbedConfig.baseUrl || imgbedConfig.base_url || '',
            random_endpoint: imgbedConfig.randomEndpoint || imgbedConfig.random_endpoint || '',
            list_endpoint: imgbedConfig.listEndpoint || imgbedConfig.list_endpoint || '',
            file_route_prefix: imgbedConfig.fileRoutePrefix || imgbedConfig.file_route_prefix || '/file',
        };

        const hasImgBedOverride = Boolean(
            runtimeSource.base_url || runtimeSource.random_endpoint || runtimeSource.list_endpoint
        );

        if (hasImgBedOverride) {
            this.dataLoader.setRuntimeSourceConfig(runtimeSource);
        }
    }
}

// 页面加载完成后初始化画廊
document.addEventListener('DOMContentLoaded', () => {
    window.gallery = new Gallery();
});
