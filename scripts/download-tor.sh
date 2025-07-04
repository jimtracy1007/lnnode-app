#!/bin/bash

# Tor 二进制文件下载脚本
# 用于下载官方 Tor Expert Bundle 并提取 tor 二进制文件

set -e  # 出错时退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${PROJECT_ROOT}/bin"

echo -e "${GREEN}🔽 开始下载 Tor 二进制文件...${NC}"

# 创建临时目录
TEMP_DIR=$(mktemp -d)
echo "临时目录: ${TEMP_DIR}"

# 清理函数
cleanup() {
    echo -e "${YELLOW}🧹 清理临时文件...${NC}"
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

# 下载并提取 macOS x86_64 版本
echo -e "${GREEN}📥 下载 macOS x86_64 版本...${NC}"
cd "${TEMP_DIR}"

# macOS x86_64 版本
MACOS_X64_URL="https://archive.torproject.org/tor-package-archive/torbrowser/14.5.4/tor-expert-bundle-macos-x86_64-14.5.4.tar.gz"
MACOS_X64_FILE="tor-expert-bundle-macos-x86_64-14.5.4.tar.gz"

wget "${MACOS_X64_URL}" -O "${MACOS_X64_FILE}"
echo -e "${GREEN}✅ macOS x86_64 下载完成${NC}"

# 解压 macOS x86_64
echo -e "${GREEN}📦 解压 macOS x86_64...${NC}"
tar -xzf "${MACOS_X64_FILE}"

# 查找 tor 二进制文件
TOR_BINARY_X64=$(find . -name "tor" -type f | head -1)
if [ -z "${TOR_BINARY_X64}" ]; then
    echo -e "${RED}❌ 未找到 tor 二进制文件${NC}"
    exit 1
fi

echo "找到 tor 二进制文件: ${TOR_BINARY_X64}"

# 确保目标目录存在
mkdir -p "${BIN_DIR}/darwin-x64"
mkdir -p "${BIN_DIR}/darwin-arm64"

# 复制到 darwin-x64
cp "${TOR_BINARY_X64}" "${BIN_DIR}/darwin-x64/tor"
chmod +x "${BIN_DIR}/darwin-x64/tor"
echo -e "${GREEN}✅ 已复制到 ${BIN_DIR}/darwin-x64/tor${NC}"

# 下载并提取 macOS aarch64 版本
echo -e "${GREEN}📥 下载 macOS aarch64 版本...${NC}"

# 清理之前的文件
rm -rf tor-expert-bundle*

# macOS aarch64 版本
MACOS_ARM64_URL="https://archive.torproject.org/tor-package-archive/torbrowser/14.5.4/tor-expert-bundle-macos-aarch64-14.5.4.tar.gz"
MACOS_ARM64_FILE="tor-expert-bundle-macos-aarch64-14.5.4.tar.gz"

wget "${MACOS_ARM64_URL}" -O "${MACOS_ARM64_FILE}"
echo -e "${GREEN}✅ macOS aarch64 下载完成${NC}"

# 解压 macOS aarch64
echo -e "${GREEN}📦 解压 macOS aarch64...${NC}"
tar -xzf "${MACOS_ARM64_FILE}"

# 查找 tor 二进制文件
TOR_BINARY_ARM64=$(find . -name "tor" -type f | head -1)
if [ -z "${TOR_BINARY_ARM64}" ]; then
    echo -e "${RED}❌ 未找到 tor 二进制文件${NC}"
    exit 1
fi

echo "找到 tor 二进制文件: ${TOR_BINARY_ARM64}"

# 复制到 darwin-arm64
cp "${TOR_BINARY_ARM64}" "${BIN_DIR}/darwin-arm64/tor"
chmod +x "${BIN_DIR}/darwin-arm64/tor"
echo -e "${GREEN}✅ 已复制到 ${BIN_DIR}/darwin-arm64/tor${NC}"

# 验证文件
echo -e "${GREEN}🔍 验证下载的文件...${NC}"
if [ -f "${BIN_DIR}/darwin-x64/tor" ] && [ -x "${BIN_DIR}/darwin-x64/tor" ]; then
    TOR_X64_VERSION=$(${BIN_DIR}/darwin-x64/tor --version | head -1)
    echo "darwin-x64/tor: ${TOR_X64_VERSION}"
else
    echo -e "${RED}❌ darwin-x64/tor 验证失败${NC}"
    exit 1
fi

if [ -f "${BIN_DIR}/darwin-arm64/tor" ] && [ -x "${BIN_DIR}/darwin-arm64/tor" ]; then
    TOR_ARM64_VERSION=$(${BIN_DIR}/darwin-arm64/tor --version | head -1)
    echo "darwin-arm64/tor: ${TOR_ARM64_VERSION}"
else
    echo -e "${RED}❌ darwin-arm64/tor 验证失败${NC}"
    exit 1
fi

# 显示文件大小
echo -e "${GREEN}📊 文件信息:${NC}"
ls -lh "${BIN_DIR}/darwin-x64/tor"
ls -lh "${BIN_DIR}/darwin-arm64/tor"

echo -e "${GREEN}🎉 Tor 二进制文件下载和安装完成！${NC}"
echo -e "${YELLOW}📝 接下来的步骤:${NC}"
echo "1. 运行您的应用程序"
echo "2. 在配置中启用 Tor (LIT_ENABLE_TOR=true)"
echo "3. 检查 Tor 服务是否正常启动"

# 显示当前 bin 目录结构
echo -e "${GREEN}📁 当前 bin 目录结构:${NC}"
ls -la "${BIN_DIR}/"
echo ""
echo "darwin-x64 目录:"
ls -la "${BIN_DIR}/darwin-x64/"
echo ""
echo "darwin-arm64 目录:"
ls -la "${BIN_DIR}/darwin-arm64/" 