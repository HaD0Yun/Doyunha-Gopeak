#!/bin/bash
#
# Godot MCP Addon Installer for Linux/macOS
# Installs Auto Reload, Editor Bridge, and Runtime addons to your Godot project
#
# Usage: Run this script in your Godot project folder
#   curl -sL https://raw.githubusercontent.com/HaD0Yun/Doyunha-Gopeak/main/install-addon.sh | bash
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

REPO_URL="https://raw.githubusercontent.com/HaD0Yun/Doyunha-Gopeak/main"

AUTO_RELOAD_ONLY=false
RUNTIME_ONLY=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --auto-reload-only)
            AUTO_RELOAD_ONLY=true
            shift
            ;;
        --runtime-only)
            RUNTIME_ONLY=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -h|--help)
            echo "Godot MCP Addon Installer"
            echo ""
            echo "Usage: install-addon.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --auto-reload-only    Install only Auto Reload addon"
            echo "  --runtime-only        Install only Runtime addon"
            echo "  -f, --force           Overwrite existing addons"
            echo "  -h, --help            Show this help message"
            echo ""
            echo "Run this script from your Godot project folder (where project.godot is located)."
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${CYAN}=====================================${NC}"
echo -e "${CYAN}  Godot MCP Addon Installer${NC}"
echo -e "${CYAN}=====================================${NC}"
echo ""

if [ ! -f "project.godot" ]; then
    echo -e "${RED}ERROR: project.godot not found!${NC}"
    echo -e "${YELLOW}Please run this script from your Godot project folder.${NC}"
    exit 1
fi

echo -e "${GREEN}[✓]${NC} Found project.godot"

if [ ! -d "addons" ]; then
    mkdir -p addons
    echo -e "${GREEN}[✓]${NC} Created addons/ directory"
fi

download_file() {
    local url="$1"
    local dest="$2"
    local dir=$(dirname "$dest")
    
    mkdir -p "$dir"
    
    if command -v curl &> /dev/null; then
        curl -sL "$url" -o "$dest"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$dest"
    else
        echo -e "${RED}ERROR: Neither curl nor wget found. Please install one of them.${NC}"
        exit 1
    fi
}

install_auto_reload() {
    echo ""
    echo -e "${YELLOW}Installing Auto Reload addon...${NC}"
    
    local addon_path="addons/auto_reload"
    
    if [ -d "$addon_path" ] && [ "$FORCE" = false ]; then
        echo -e "${YELLOW}Auto Reload addon already exists. Use --force to overwrite.${NC}"
        return 1
    fi
    
    if [ -d "$addon_path" ]; then
        rm -rf "$addon_path"
    fi
    
    mkdir -p "$addon_path"
    
    local files=("auto_reload.gd" "plugin.cfg")
    local success=true
    
    for file in "${files[@]}"; do
        echo -e "  Downloading $file..."
        if ! download_file "$REPO_URL/src/addon/auto_reload/$file" "$addon_path/$file"; then
            echo -e "  ${RED}Failed to download $file${NC}"
            success=false
        fi
    done
    
    if [ "$success" = true ]; then
        echo -e "${GREEN}[✓]${NC} Auto Reload addon installed successfully!"
        return 0
    fi
    return 1
}

install_runtime() {
    echo ""
    echo -e "${YELLOW}Installing Runtime addon...${NC}"
    
    local addon_path="addons/godot_mcp_runtime"
    
    if [ -d "$addon_path" ] && [ "$FORCE" = false ]; then
        echo -e "${YELLOW}Runtime addon already exists. Use --force to overwrite.${NC}"
        return 1
    fi
    
    if [ -d "$addon_path" ]; then
        rm -rf "$addon_path"
    fi
    
    mkdir -p "$addon_path"
    
    local files=("godot_mcp_runtime.gd" "mcp_runtime_autoload.gd" "plugin.cfg")
    local success=true
    
    for file in "${files[@]}"; do
        echo -e "  Downloading $file..."
        if ! download_file "$REPO_URL/src/addon/godot_mcp_runtime/$file" "$addon_path/$file"; then
            echo -e "  ${RED}Failed to download $file${NC}"
            success=false
        fi
    done
    
    if [ "$success" = true ]; then
        echo -e "${GREEN}[✓]${NC} Runtime addon installed successfully!"
        return 0
    fi
    return 1
}

install_editor_plugin() {
    echo ""
    echo -e "${YELLOW}Installing Editor Bridge addon...${NC}"

    local addon_path="addons/godot_mcp_editor"

    if [ -d "$addon_path" ] && [ "$FORCE" = false ]; then
        echo -e "${YELLOW}Editor Bridge addon already exists. Use --force to overwrite.${NC}"
        return 1
    fi

    if [ -d "$addon_path" ]; then
        rm -rf "$addon_path"
    fi

    mkdir -p "$addon_path/tools"

    local files=(
        "plugin.cfg"
        "plugin.gd"
        "mcp_client.gd"
        "tool_executor.gd"
        "tools/animation_tools.gd"
        "tools/resource_tools.gd"
        "tools/scene_tools.gd"
    )
    local success=true

    for file in "${files[@]}"; do
        echo -e "  Downloading $file..."
        if ! download_file "$REPO_URL/src/addon/godot_mcp_editor/$file" "$addon_path/$file"; then
            echo -e "  ${RED}Failed to download $file${NC}"
            success=false
        fi
    done

    if [ "$success" = true ]; then
        echo -e "${GREEN}[✓]${NC} Editor Bridge addon installed successfully!"
        return 0
    fi
    return 1
}

if [ "$AUTO_RELOAD_ONLY" = true ]; then
    install_auto_reload
elif [ "$RUNTIME_ONLY" = true ]; then
    install_runtime
else
    install_auto_reload
    install_editor_plugin
    install_runtime
fi

echo ""
echo -e "${CYAN}=====================================${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${CYAN}=====================================${NC}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo "  1. Open your project in Godot"
echo "  2. Go to Project > Project Settings > Plugins"
echo "  3. Enable the installed addon(s), including ${BOLD}godot_mcp_editor${NC} for bridge-backed tools"
echo ""
echo "For more info: https://github.com/HaD0Yun/Doyunha-Gopeak"
