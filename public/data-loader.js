// 数据加载模块
class DataLoader {
    constructor(options = {}) {
        this.galleryData = null;
        this.loading = false;
        this.shuffleEnabled = options.shuffleEnabled ?? true;
        this.galleryIndexUrl = options.galleryIndexUrl || 'gallery-index.json';
        this.galleryDataApiUrl = options.galleryDataApiUrl || '/api/gallery-data';
        this.galleryDataMode = options.galleryDataMode || 'static';
        this.runtimeSourceConfig = null;
        // 图片代理功能：通过本站 /api/img-proxy 中转图床图片，利用 Cloudflare Cache 加速
        this.imgProxyEnabled = false;
        this.imgProxyBaseUrl = '/api/img-proxy';
        this.imgbedHost = '';
    }

    // 从本地JSON文件加载图片数据
    async loadGalleryData() {
        if (this.galleryData) {
            return this.galleryData;
        }

        if (this.loading) {
            return this.galleryData;
        }

        this.loading = true;
        
        try {
            if (this.galleryDataMode === 'imgbed-api') {
                this.galleryData = await this.loadGalleryDataFromApi();
            } else {
                this.galleryData = await this.loadGalleryDataFromStatic();
            }
            this.galleryData = this.applyConfiguredDirFilter(this.galleryData);

            console.log('图片数据加载成功:', this.galleryData);
            return this.galleryData;
        } catch (error) {
            console.error('加载图片数据失败:', error);
            try {
                // 动态模式失败时，尝试降级读取静态索引
                this.galleryData = await this.loadGalleryDataFromStatic();
                this.galleryData = this.applyConfiguredDirFilter(this.galleryData);
                console.warn('已降级为静态索引模式');
                return this.galleryData;
            } catch (fallbackError) {
                console.error('静态索引降级也失败:', fallbackError);
            }

            // 返回空数据，避免页面崩溃
            this.galleryData = {
                gallery: {},
                total_images: 0,
                generated_at: new Date().toISOString()
            };
            return this.galleryData;
        } finally {
            this.loading = false;
        }
    }

    async loadGalleryDataFromStatic() {
        const response = await fetch(this.galleryIndexUrl);
        if (!response.ok) {
            throw new Error(`静态索引请求失败: HTTP ${response.status}`);
        }
        return response.json();
    }

    async loadGalleryDataFromApi() {
        const response = await fetch(this.galleryDataApiUrl, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`动态图库请求失败: HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (!payload?.success || !payload?.data) {
            throw new Error(payload?.message || '动态图库返回格式无效');
        }

        return payload.data;
    }

    // 获取所有分类
    getCategories() {
        if (!this.galleryData) return [];
        return Object.keys(this.galleryData.gallery || {});
    }

    // 获取指定分类的图片
    getImagesByCategory(category) {
        if (!this.galleryData || !this.galleryData.gallery) return [];
        const images = this.galleryData.gallery[category]?.images || [];
        return this.shuffleImages(images).map(img => this.proxyImageData(img));
    }

    // 获取所有图片（用于"全部"标签）
    getAllImages() {
        if (!this.galleryData || !this.galleryData.gallery) return [];

        const allImages = [];
        const categories = Object.keys(this.galleryData.gallery);

        // 随机打乱分类顺序（可配置）
        const shuffledCategories = this.shuffleEnabled
            ? [...categories].sort(() => Math.random() - 0.5)
            : [...categories];

        // 使用Set去重
        const uniqueImageUrls = new Set();

        shuffledCategories.forEach(category => {
            const images = this.galleryData.gallery[category].images || [];
            images.forEach(img => {
                if (!uniqueImageUrls.has(img.original)) {
                    uniqueImageUrls.add(img.original);
                    allImages.push(img);
                }
            });
        });

        return this.shuffleImages(allImages).map(img => this.proxyImageData(img));
    }

    // 获取总图片数
    getTotalImages() {
        return this.galleryData?.total_images || 0;
    }

    // 设置是否启用随机排序
    setShuffleEnabled(enabled) {
        this.shuffleEnabled = Boolean(enabled);
    }

    // 获取当前随机排序状态
    isShuffleEnabled() {
        return this.shuffleEnabled;
    }

    // 获取索引来源信息
    getSourceInfo() {
        const sourceFromIndex = this.galleryData?.source || null;
        if (!this.runtimeSourceConfig) {
            return sourceFromIndex;
        }

        return {
            ...(sourceFromIndex || {}),
            ...this.runtimeSourceConfig,
        };
    }

    // 是否支持随机图 API
    hasRandomApi() {
        const source = this.getSourceInfo();
        return Boolean(source?.random_endpoint || source?.base_url);
    }

    // 获取一张随机图（ImgBed random API）
    async fetchRandomImage(options = {}) {
        const source = this.getSourceInfo();
        if (!source || !this.hasRandomApi()) {
            throw new Error('当前配置未启用随机图 API');
        }

        const baseUrl = (source.base_url || window.location.origin).replace(/\/+$/, '');
        const randomEndpoint = source.random_endpoint || `${baseUrl}/random`;
        const randomUrl = this.toAbsoluteUrl(randomEndpoint, baseUrl);

        const urlObj = new URL(randomUrl);
        urlObj.searchParams.set('type', 'url');
        urlObj.searchParams.set('content', options.content || 'image');
        const orientationInput =
            options.orientation !== undefined
                ? options.orientation
                : this.getConfiguredRandomOrientation(source);
        const preferredOrientation = this.normalizeRandomOrientation(orientationInput);
        if (preferredOrientation) {
            urlObj.searchParams.set('orientation', preferredOrientation);
        }

        const preferredDir = this.normalizeDirPath(options.dir || this.getConfiguredListDir(source));
        if (preferredDir) {
            urlObj.searchParams.set('dir', preferredDir);
        }

        const response = await fetch(urlObj.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
            },
        });

        if (!response.ok) {
            throw new Error(`随机图接口请求失败: HTTP ${response.status}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        let rawUrl = '';

        if (contentType.includes('application/json')) {
            const payload = await response.json();
            rawUrl = payload?.url || payload?.src || payload?.data?.url || payload?.data?.src || '';
        } else {
            const text = (await response.text()).trim();
            if (text.startsWith('{')) {
                try {
                    const payload = JSON.parse(text);
                    rawUrl = payload?.url || payload?.src || payload?.data?.url || payload?.data?.src || '';
                } catch {
                    rawUrl = text;
                }
            } else {
                rawUrl = text;
            }
        }

        if (!rawUrl) {
            throw new Error('随机图接口返回为空');
        }

        const imageUrl = this.normalizeImageUrl(rawUrl, source, baseUrl);

        return this.proxyImageData({
            name: 'random-image',
            original: imageUrl,
            preview: imageUrl,
            category: 'random',
        });
    }

    // 设置索引地址
    setGalleryIndexUrl(url) {
        const normalized = String(url || '').trim();
        this.galleryIndexUrl = normalized || 'gallery-index.json';
    }

    // 设置图库数据模式（static / imgbed-api）
    setGalleryDataMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        this.galleryDataMode = normalized === 'imgbed-api' ? 'imgbed-api' : 'static';
    }

    // 设置动态图库 API 地址
    setGalleryDataApiUrl(url) {
        const normalized = String(url || '').trim();
        this.galleryDataApiUrl = normalized || '/api/gallery-data';
    }

    // 设置运行时来源配置（会覆盖索引中的 source 字段）
    setRuntimeSourceConfig(sourceConfig) {
        if (!sourceConfig || typeof sourceConfig !== 'object') {
            this.runtimeSourceConfig = null;
            return;
        }
        const normalized = {};
        Object.entries(sourceConfig).forEach(([key, value]) => {
            if (value === null || value === undefined) return;
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return;
                normalized[key] = trimmed;
                return;
            }
            normalized[key] = value;
        });

        this.runtimeSourceConfig = Object.keys(normalized).length ? normalized : null;
    }

    // ——— 图片代理相关方法 ———

    // 启用图片代理，传入图床 base URL 以提取域名
    enableImgProxy(imgbedBaseUrl) {
        if (!imgbedBaseUrl) return;
        try {
            const parsed = new URL(imgbedBaseUrl);
            this.imgbedHost = parsed.host.toLowerCase();
            this.imgProxyEnabled = true;
            // 缓存图床 origin 供 preconnect 使用（即使走代理，也可能有直连场景）
            try {
                localStorage.setItem('gallery-imgbed-origin', parsed.origin);
            } catch {
                // ignore
            }
        } catch {
            this.imgProxyEnabled = false;
        }
    }

    // 将图床图片 URL 转为本站代理 URL
    toProxiedUrl(imageUrl) {
        if (!this.imgProxyEnabled || !imageUrl) return imageUrl;
        // 仅代理指向图床域名的外部 URL
        try {
            const parsed = new URL(imageUrl, window.location.origin);
            if (parsed.host.toLowerCase() !== this.imgbedHost) return imageUrl;
            // 已经是相对路径或本站域名则不代理
            if (parsed.origin === window.location.origin) return imageUrl;
        } catch {
            return imageUrl;
        }
        return `${this.imgProxyBaseUrl}?url=${encodeURIComponent(imageUrl)}`;
    }

    // 批量转换图片数据中的 URL
    proxyImageData(imageItem) {
        if (!this.imgProxyEnabled || !imageItem) return imageItem;
        return {
            ...imageItem,
            original: this.toProxiedUrl(imageItem.original),
            preview: this.toProxiedUrl(imageItem.preview),
        };
    }

    shuffleImages(images) {
        const copied = [...images];
        if (!this.shuffleEnabled) return copied;
        return copied.sort(() => Math.random() - 0.5);
    }

    toAbsoluteUrl(urlOrPath, baseUrl) {
        if (!urlOrPath) return '';
        if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
        const clean = urlOrPath.replace(/^\/+/, '');
        return `${baseUrl}/${clean}`;
    }

    normalizeImageUrl(rawUrl, source, baseUrl) {
        if (/^https?:\/\//i.test(rawUrl)) {
            return rawUrl;
        }

        let clean = rawUrl.replace(/^\/+/, '');
        const filePrefix = (source?.file_route_prefix || '/file').replace(/^\/+|\/+$/g, '');
        if (filePrefix && !clean.startsWith(`${filePrefix}/`)) {
            clean = `${filePrefix}/${clean}`;
        }

        return `${baseUrl}/${clean}`;
    }

    normalizeDirPath(pathValue) {
        return String(pathValue || '').trim().replace(/^\/+|\/+$/g, '');
    }

    getConfiguredListDir(source = null) {
        const sourceInfo = source || this.getSourceInfo() || {};
        return this.normalizeDirPath(sourceInfo.list_dir || sourceInfo.listDir || '');
    }

    normalizeRandomOrientation(orientation) {
        const normalized = String(orientation || '').trim().toLowerCase();
        const valid = ['auto', 'landscape', 'portrait', 'square'];
        if (!normalized) return '';
        return valid.includes(normalized) ? normalized : '';
    }

    getConfiguredRandomOrientation(source = null) {
        const sourceInfo = source || this.getSourceInfo() || {};
        return this.normalizeRandomOrientation(
            sourceInfo.random_orientation || sourceInfo.randomOrientation || ''
        );
    }

    extractRelativePathFromImageUrl(imageUrl, fileRoutePrefix) {
        if (!imageUrl) return '';

        try {
            const parsed = new URL(imageUrl, window.location.origin);
            let pathname = decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '');
            const cleanPrefix = this.normalizeDirPath(fileRoutePrefix || '/file');
            if (cleanPrefix && pathname.startsWith(`${cleanPrefix}/`)) {
                pathname = pathname.slice(cleanPrefix.length + 1);
            }
            return pathname;
        } catch {
            return '';
        }
    }

    applyConfiguredDirFilter(galleryData) {
        if (!galleryData || typeof galleryData !== 'object' || !galleryData.gallery) {
            return galleryData;
        }

        const source = this.getSourceInfo() || {};
        const displayDir = this.getConfiguredListDir(source);
        if (!displayDir) return galleryData;
        const sourceListDir = this.normalizeDirPath(
            galleryData?.source?.list_dir || galleryData?.source?.listDir || ''
        );

        // 数据源已经按同一目录过滤过，直接复用，避免二次误筛
        if (sourceListDir && sourceListDir === displayDir) {
            return {
                ...galleryData,
                source: {
                    ...(galleryData.source || {}),
                    list_dir: displayDir,
                },
            };
        }

        // 若数据源已在父目录过滤过，转为对子路径进行二次筛选
        let effectiveDir = displayDir;
        if (sourceListDir && displayDir.startsWith(`${sourceListDir}/`)) {
            effectiveDir = displayDir.slice(sourceListDir.length + 1);
        }
        if (!effectiveDir) return galleryData;

        const fileRoutePrefix = source.file_route_prefix || source.fileRoutePrefix || '/file';
        const filteredGallery = {};
        let totalImages = 0;

        Object.entries(galleryData.gallery || {}).forEach(([category, categoryData]) => {
            const images = Array.isArray(categoryData?.images) ? categoryData.images : [];
            const matchedImages = images.filter((imageItem) => {
                const relativePath = this.extractRelativePathFromImageUrl(
                    imageItem.original || imageItem.preview,
                    fileRoutePrefix
                );
                return relativePath === effectiveDir || relativePath.startsWith(`${effectiveDir}/`);
            });

            if (matchedImages.length) {
                filteredGallery[category] = {
                    ...(categoryData || {}),
                    images: matchedImages,
                };
                totalImages += matchedImages.length;
            }
        });

        console.log(
            `按目录筛选图片: dir=${displayDir}, effectiveDir=${effectiveDir}, 匹配数量=${totalImages}`
        );

        return {
            ...galleryData,
            gallery: filteredGallery,
            total_images: totalImages,
            source: {
                ...(galleryData.source || {}),
                list_dir: displayDir,
            },
        };
    }
}

// 导出为全局变量
window.DataLoader = DataLoader; 
