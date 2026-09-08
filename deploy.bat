@echo off
setlocal
cd /d "%~dp0"
set "GALLERY_PAGES_PROJECT=%~1"
if not defined GALLERY_PAGES_PROJECT set "GALLERY_PAGES_PROJECT=%CLOUDFLARE_PAGES_PROJECT_NAME%"
if not defined GALLERY_PAGES_PROJECT set "GALLERY_PAGES_PROJECT=gallery-portfolio-static"
chcp 65001 >nul
echo ========================================
echo Gallery Portfolio 部署脚本
echo ========================================

:: 检查是否存在gallery-index.json文件
if not exist "gallery-index.json" (
    echo 错误: 未找到 gallery-index.json 文件
    echo 请先运行 npm run imgbed:generate-index 生成图片索引
    pause
    exit /b 1
)

echo 正在准备部署文件...

:: 检查是否安装了wrangler
if not exist "node_modules\wrangler\package.json" (
    echo 错误: 未安装项目依赖，请先运行 npm ci
    echo 然后运行: npm exec -- wrangler login
    pause
    exit /b 1
)

echo 开始部署到 Cloudflare Pages...
echo.

:: 使用wrangler部署
call npm run deploy -- --project-name "%GALLERY_PAGES_PROJECT%"

if errorlevel 1 (
    echo.
    echo 部署失败，请检查错误信息
    pause
    exit /b 1
)

echo.
echo ========================================
echo 部署完成!
echo 请访问您的 Cloudflare Pages 域名查看效果
echo ========================================
pause
