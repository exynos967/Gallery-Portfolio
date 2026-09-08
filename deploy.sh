#!/bin/bash

# 部署脚本 (Linux/macOS版本)
# 使用Wrangler部署到Cloudflare Pages
cd -- "$(dirname -- "$0")" || exit 1
GALLERY_PAGES_PROJECT="${1:-${CLOUDFLARE_PAGES_PROJECT_NAME:-gallery-portfolio-static}}"

echo "========================================"
echo "Gallery Portfolio 部署脚本"
echo "========================================"

# 检查必要文件
echo "检查必要文件..."

if [ ! -f "gallery-index.json" ]; then
    echo "错误: gallery-index.json 不存在"
    echo "请先运行 npm run imgbed:generate-index 生成图片索引"
    exit 1
fi

if [ ! -f "index.html" ]; then
    echo "错误: index.html 不存在"
    exit 1
fi

echo "✓ 必要文件检查通过"

# 检查Wrangler
echo "检查Wrangler..."
if [ -f "node_modules/wrangler/package.json" ]; then
    echo "✓ Wrangler 已安装"
    npm exec --no -- wrangler --version
else
    echo "错误: 未安装项目依赖，请先运行 npm ci"
    exit 1
fi

# 检查是否已登录
echo "检查Cloudflare登录状态..."
if ! npm exec --no -- wrangler whoami &> /dev/null; then
    echo "需要登录Cloudflare..."
    echo "请运行: npm exec -- wrangler login"
    exit 1
fi

echo "✓ 已登录Cloudflare"

# 开始部署
echo
echo "开始部署到Cloudflare Pages..."
echo "项目名称: $GALLERY_PAGES_PROJECT"

if npm run deploy -- --project-name "$GALLERY_PAGES_PROJECT"; then
    echo
    echo "========================================"
    echo "部署成功！"
    echo "您的网站应该已经可以访问了"
    echo "========================================"
else
    echo
    echo "========================================"
    echo "部署失败！"
    echo "请检查错误信息并重试"
    echo "========================================"
    exit 1
fi
