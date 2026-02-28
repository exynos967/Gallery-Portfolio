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
    }

    // 从本地JSON文件加载图片数据
    async loadGalleryData() {
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

            console.log('图片数据加载成功:', this.galleryData);
            return this.galleryData;
        } catch (error) {
            console.error('加载图片数据失败:', error);
            try {
                // 动态模式失败时，尝试降级读取静态索引
                this.galleryData = await this.loadGalleryDataFromStatic();
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
        return this.shuffleImages(images);
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
        
        return this.shuffleImages(allImages);
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
        urlObj.searchParams.set('orientation', options.orientation || 'auto');

        if (options.dir) {
            urlObj.searchParams.set('dir', options.dir);
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

        return {
            name: 'random-image',
            original: imageUrl,
            preview: imageUrl,
            category: 'random',
        };
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
        this.runtimeSourceConfig = { ...sourceConfig };
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
}

// 导出为全局变量
window.DataLoader = DataLoader; 
