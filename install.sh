#!/usr/bin/env bash
# CAPA Installer Script for macOS and Linux
# Licensed under the MIT license
#
# NOTE: This installer is fetched over HTTPS but is not signed. For air-gapped
# or high-security environments, download install.sh + SHA256SUMS manually and
# verify before running.

set -u

# Tracks whether add_to_path actually modified a shell profile during this run.
# Used to decide whether to print the "restart your shell" reminder.
CAPA_MODIFIED_PROFILE=0

APP_NAME="capa"
GITHUB_REPO="infragate/capa"
FALLBACK_VERSION="1.0.0"  # Fallback version if API request fails

# Fetch latest release version from GitHub
get_latest_version() {
    local _version
    
    say_verbose "Fetching latest release version from GitHub..."
    
    # Try to fetch from GitHub API
    if check_cmd curl; then
        _version=$(curl -sSfL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')
    elif check_cmd wget; then
        _version=$(wget -qO- "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')
    fi
    
    # Validate we got a version
    if [ -z "$_version" ] || [ "$_version" = "null" ]; then
        warn "Failed to fetch latest version from GitHub API"
        warn "Falling back to version ${FALLBACK_VERSION}"
        _version="${FALLBACK_VERSION}"
    else
        say_verbose "Latest version: $_version"
    fi
    
    RETVAL="$_version"
}

# Customize installation via environment variables
CAPA_INSTALL_DIR="${CAPA_INSTALL_DIR:-}"
CAPA_NO_MODIFY_PATH="${CAPA_NO_MODIFY_PATH:-0}"
CAPA_UNMANAGED_INSTALL="${CAPA_UNMANAGED_INSTALL:-}"
PRINT_VERBOSE="${CAPA_PRINT_VERBOSE:-0}"
PRINT_QUIET="${CAPA_PRINT_QUIET:-0}"

if [ -n "${CAPA_UNMANAGED_INSTALL}" ]; then
    CAPA_NO_MODIFY_PATH=1
fi

# Colors for output
RED=$(tput setaf 1 2>/dev/null || echo '')
GREEN=$(tput setaf 2 2>/dev/null || echo '')
YELLOW=$(tput setaf 3 2>/dev/null || echo '')
BLUE=$(tput setaf 4 2>/dev/null || echo '')
RESET=$(tput sgr0 2>/dev/null || echo '')

usage() {
    cat <<EOF
capa-installer.sh

The installer for CAPA (Capabilities Package Manager)

This script detects your platform and installs the appropriate binary to:
    \$CAPA_INSTALL_DIR (if set)
    \$HOME/.local/bin (default)
    /usr/local/bin (with sudo)

It will then add that directory to PATH by modifying your shell profile.

USAGE:
    capa-installer.sh [OPTIONS]

OPTIONS:
    -v, --verbose
            Enable verbose output

    -q, --quiet
            Disable progress output

        --no-modify-path
            Don't configure the PATH environment variable

        --install-dir DIR
            Install to a custom directory

    -h, --help
            Print help information

ENVIRONMENT VARIABLES:
    CAPA_INSTALL_DIR        Custom installation directory
    CAPA_NO_MODIFY_PATH     Set to 1 to skip PATH modification
    CAPA_UNMANAGED_INSTALL  Set to 1 for CI/unmanaged installs
    CAPA_PRINT_VERBOSE      Set to 1 for verbose output
    CAPA_PRINT_QUIET        Set to 1 for quiet output

EXAMPLES:
    # Install with defaults
    curl -LsSf https://capa.infragate.ai/install.sh | sh

    # Install to custom directory
    CAPA_INSTALL_DIR=~/bin curl -LsSf https://capa.infragate.ai/install.sh | sh

    # Install without modifying PATH
    CAPA_NO_MODIFY_PATH=1 curl -LsSf https://capa.infragate.ai/install.sh | sh
EOF
}

say() {
    if [ "0" = "$PRINT_QUIET" ]; then
        echo "$1"
    fi
}

say_verbose() {
    if [ "1" = "$PRINT_VERBOSE" ]; then
        echo "$1"
    fi
}

info() {
    say "${BLUE}INFO${RESET}: $1"
}

warn() {
    if [ "0" = "$PRINT_QUIET" ]; then
        say "${YELLOW}WARN${RESET}: $1" >&2
    fi
}

err() {
    if [ "0" = "$PRINT_QUIET" ]; then
        say "${RED}ERROR${RESET}: $1" >&2
    fi
    exit 1
}

success() {
    say "${GREEN}✓${RESET} $1"
}

need_cmd() {
    if ! check_cmd "$1"; then
        err "need '$1' (command not found)"
    fi
}

check_cmd() {
    command -v "$1" > /dev/null 2>&1
}

assert_nz() {
    if [ -z "$1" ]; then err "assert_nz $2"; fi
}

ensure() {
    if ! "$@"; then err "command failed: $*"; fi
}

# Detect architecture
get_architecture() {
    local _ostype _cputype _arch

    _ostype="$(uname -s)"
    _cputype="$(uname -m)"

    case "$_ostype" in
        Linux)
            _ostype=unknown-linux-gnu
            ;;
        Darwin)
            _ostype=apple-darwin
            ;;
        *)
            err "unsupported OS type: $_ostype"
            ;;
    esac

    case "$_cputype" in
        x86_64 | x86-64 | x64 | amd64)
            _cputype=x86_64
            ;;
        arm64 | aarch64)
            _cputype=aarch64
            ;;
        *)
            err "unsupported CPU type: $_cputype"
            ;;
    esac

    _arch="${_cputype}-${_ostype}"
    RETVAL="$_arch"
}

# Download using curl or wget
downloader() {
    local _dld

    if check_cmd curl; then
        _dld=curl
    elif check_cmd wget; then
        _dld=wget
    else
        err "need 'curl' or 'wget' (neither found)"
    fi

    if [ "$1" = --check ]; then
        need_cmd "$_dld"
    elif [ "$_dld" = curl ]; then
        curl -sSfL "$1" -o "$2"
    elif [ "$_dld" = wget ]; then
        wget "$1" -O "$2"
    else
        err "Unknown downloader"
    fi
}

# Get installation directory
get_install_dir() {
    if [ -n "${CAPA_INSTALL_DIR}" ]; then
        RETVAL="${CAPA_INSTALL_DIR}"
    elif [ -n "${HOME:-}" ]; then
        RETVAL="${HOME}/.local/bin"
    else
        err "cannot determine installation directory"
    fi
}

# Check if directory is in PATH
is_in_path() {
    local _dir="$1"
    case ":${PATH}:" in
        *:"$_dir":*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Return 0 if the given shell profile already references the install dir,
# either as the expanded absolute path or as $HOME-prefixed form.
profile_has_dir() {
    local _profile="$1"
    local _dir="$2"
    local _rel

    [ ! -f "$_profile" ] && return 1

    # Literal expanded path match (this is what the installer writes).
    if grep -qF -- "$_dir" "$_profile"; then
        return 0
    fi

    # If _dir is under $HOME, also accept $HOME / ${HOME} prefixed forms
    # written by hand by the user.
    if [ -n "${HOME:-}" ]; then
        case "$_dir" in
            "$HOME"/*)
                _rel="${_dir#"$HOME"/}"
                if grep -qE "\\\$\{?HOME\}?/${_rel}" "$_profile"; then
                    return 0
                fi
                ;;
        esac
    fi

    return 1
}

# Pick the shell profile file most appropriate for the USER'S shell (not the
# shell this script is running in). We deliberately ignore $BASH_VERSION and
# $ZSH_VERSION here -- those reflect the interpreter executing install.sh
# (which is bash via our shebang), NOT the user's login shell. Trusting them
# would always pick the bash branch even for zsh users.
detect_shell_profile() {
    local _shell_profile=""
    local _ostype
    _ostype="$(uname -s 2>/dev/null || echo unknown)"

    # Primary signal: the user's login shell.
    case "${SHELL:-}" in
        */zsh)
            _shell_profile="${HOME}/.zshrc"
            ;;
        */bash)
            # On macOS, login bash sessions read .bash_profile (not .bashrc).
            # On Linux, interactive non-login bash reads .bashrc.
            if [ "$_ostype" = "Darwin" ]; then
                if [ -f "${HOME}/.bash_profile" ]; then
                    _shell_profile="${HOME}/.bash_profile"
                elif [ -f "${HOME}/.bashrc" ]; then
                    _shell_profile="${HOME}/.bashrc"
                else
                    _shell_profile="${HOME}/.bash_profile"
                fi
            else
                if [ -f "${HOME}/.bashrc" ]; then
                    _shell_profile="${HOME}/.bashrc"
                elif [ -f "${HOME}/.bash_profile" ]; then
                    _shell_profile="${HOME}/.bash_profile"
                else
                    _shell_profile="${HOME}/.bashrc"
                fi
            fi
            ;;
        */fish)
            _shell_profile="${HOME}/.config/fish/config.fish"
            ;;
        *)
            # $SHELL is unset or unrecognized -- fall back to which rc file
            # actually exists, biased toward zsh (macOS default since 10.15).
            if [ -f "${HOME}/.zshrc" ]; then
                _shell_profile="${HOME}/.zshrc"
            elif [ "$_ostype" = "Darwin" ] && [ -f "${HOME}/.bash_profile" ]; then
                _shell_profile="${HOME}/.bash_profile"
            elif [ -f "${HOME}/.bashrc" ]; then
                _shell_profile="${HOME}/.bashrc"
            elif [ -f "${HOME}/.bash_profile" ]; then
                _shell_profile="${HOME}/.bash_profile"
            elif [ -f "${HOME}/.profile" ]; then
                _shell_profile="${HOME}/.profile"
            else
                # Nothing exists -- create the canonical file for the platform.
                if [ "$_ostype" = "Darwin" ]; then
                    _shell_profile="${HOME}/.zshrc"
                else
                    _shell_profile="${HOME}/.profile"
                fi
            fi
            ;;
    esac

    RETVAL="$_shell_profile"
}

# Add directory to shell profile. Sets CAPA_MODIFIED_PROFILE=1 if it actually
# writes a new export line; returns without writing if the profile already
# references the directory.
#
# IMPORTANT: this function intentionally does NOT consult the live $PATH. The
# fact that $_dir is currently in $PATH does not imply it is persistently
# configured in the user's shell profile (e.g. a parent process may have
# injected it for this session only). Always check the profile.
add_to_path() {
    local _dir="$1"
    local _shell_profile
    local _profile_dir

    if [ "1" = "$CAPA_NO_MODIFY_PATH" ]; then
        return 0
    fi

    detect_shell_profile
    _shell_profile="$RETVAL"

    if profile_has_dir "$_shell_profile" "$_dir"; then
        say_verbose "PATH already configured in $_shell_profile"
        return 0
    fi

    # Ensure the parent directory exists (e.g. ~/.config/fish/ for fish users).
    _profile_dir="$(dirname "$_shell_profile")"
    if [ ! -d "$_profile_dir" ]; then
        ensure mkdir -p "$_profile_dir"
    fi

    info "Adding ${_dir} to PATH in ${_shell_profile}"

    # Use shell-appropriate syntax. fish doesn't understand `export FOO=bar`.
    case "$_shell_profile" in
        */fish/config.fish)
            cat >> "$_shell_profile" <<EOF

# Added by CAPA installer
fish_add_path -gP "${_dir}"
EOF
            ;;
        *)
            cat >> "$_shell_profile" <<EOF

# Added by CAPA installer
export PATH="${_dir}:\$PATH"
EOF
            ;;
    esac

    CAPA_MODIFIED_PROFILE=1
    success "Updated $_shell_profile"
}

# Main installation function
install_capa() {
    # Fetch the latest version first
    get_latest_version
    APP_VERSION="$RETVAL"
    
    local _box_inner=39
    local _banner="  CAPA Installer v${APP_VERSION}"
    local _banner_pad=$(( _box_inner - ${#_banner} ))
    [ "$_banner_pad" -lt 1 ] && _banner_pad=1
    local _banner_spaces
    _banner_spaces=$(printf '%*s' "$_banner_pad" '')
    say ""
    say "${GREEN}╔═══════════════════════════════════════╗${RESET}"
    say "${GREEN}║${_banner}${_banner_spaces}║${RESET}"
    say "${GREEN}╚═══════════════════════════════════════╝${RESET}"
    say ""

    # Check for required commands
    need_cmd uname
    need_cmd mkdir
    need_cmd chmod
    need_cmd mktemp
    downloader --check

    # Detect architecture
    info "Detecting platform..."
    get_architecture
    local _arch="$RETVAL"
    success "Detected: $_arch"

    # Determine binary name based on OS
    local _binary_name
    case "$_arch" in
        *-apple-darwin)
            _binary_name="capa-${_arch}"
            ;;
        *-linux-*)
            _binary_name="capa-${_arch}"
            ;;
        *)
            err "unsupported architecture: $_arch"
            ;;
    esac

    # Get installation directory
    get_install_dir
    local _install_dir="$RETVAL"
    info "Installation directory: $_install_dir"

    # Create installation directory
    if [ ! -d "$_install_dir" ]; then
        info "Creating installation directory..."
        ensure mkdir -p "$_install_dir"
    fi

    # Download binary
    local _download_url="https://github.com/${GITHUB_REPO}/releases/download/v${APP_VERSION}/${_binary_name}"
    local _temp_file
    _temp_file="$(mktemp)"
    
    info "Downloading CAPA..."
    say_verbose "URL: $_download_url"
    
    if ! downloader "$_download_url" "$_temp_file"; then
        err "failed to download CAPA from $_download_url"
    fi
    success "Downloaded CAPA binary"

    # Verify binary integrity against release checksums
    info "Verifying download integrity..."
    local _checksums_url="https://github.com/${GITHUB_REPO}/releases/download/v${APP_VERSION}/SHA256SUMS.txt"
    local _checksums_file
    _checksums_file="$(mktemp)"

    if ! downloader "$_checksums_url" "$_checksums_file"; then
        rm -f "$_temp_file"
        err "failed to download SHA256SUMS.txt from $_checksums_url"
    fi

    local _sha256_cmd
    if check_cmd sha256sum; then
        _sha256_cmd=sha256sum
    elif check_cmd shasum; then
        _sha256_cmd="shasum -a 256"
    else
        rm -f "$_temp_file" "$_checksums_file"
        err "need 'sha256sum' or 'shasum' for integrity verification"
    fi

    local _computed_hash _expected_hash
    _computed_hash=$($_sha256_cmd "$_temp_file" | awk '{print $1}')
    _expected_hash=$(grep -F " ${_binary_name}" "$_checksums_file" | awk '{print $1}')

    rm -f "$_checksums_file"

    if [ -z "$_expected_hash" ]; then
        rm -f "$_temp_file"
        err "no checksum found for ${_binary_name} in SHA256SUMS.txt"
    fi

    if [ "$_computed_hash" != "$_expected_hash" ]; then
        rm -f "$_temp_file"
        err "checksum verification failed for ${_binary_name} (expected ${_expected_hash}, got ${_computed_hash})"
    fi
    success "Verified binary integrity"

    # Install binary
    info "Installing to ${_install_dir}/capa..."
    ensure mv "$_temp_file" "${_install_dir}/capa"
    ensure chmod +x "${_install_dir}/capa"
    success "Installed CAPA to ${_install_dir}/capa"

    # Persist the install dir in the user's shell profile. We always call
    # add_to_path here -- being in the current process's $PATH does NOT mean
    # it is persistently configured (a parent process may have injected it for
    # this session only). add_to_path itself short-circuits if the profile
    # already references the dir.
    add_to_path "$_install_dir"
    if is_in_path "$_install_dir"; then
        say_verbose "Installation directory already on \$PATH for this session"
    fi

    # Print success message
    say ""
    say "${GREEN}╔═══════════════════════════════════════╗${RESET}"
    say "${GREEN}║  CAPA installed successfully! 🎉      ║${RESET}"
    say "${GREEN}╚═══════════════════════════════════════╝${RESET}"
    say ""
    say "To get started, run:"
    say "  ${BLUE}capa init${RESET}     # Initialize a new project"
    say "  ${BLUE}capa --help${RESET}   # Show all commands"
    say ""
    
    if [ "1" = "$CAPA_MODIFIED_PROFILE" ]; then
        detect_shell_profile
        local _profile_short="${RETVAL/#$HOME/~}"
        say "Restart your shell or run:"
        say "  ${YELLOW}source ${_profile_short}${RESET}"
        say ""
    fi

    say "Documentation: https://github.com/${GITHUB_REPO}"
    say ""
}

# Parse command line arguments
parse_args() {
    for arg in "$@"; do
        case "$arg" in
            --help | -h)
                usage
                exit 0
                ;;
            --quiet | -q)
                PRINT_QUIET=1
                ;;
            --verbose | -v)
                PRINT_VERBOSE=1
                ;;
            --no-modify-path)
                CAPA_NO_MODIFY_PATH=1
                ;;
            --install-dir)
                shift
                CAPA_INSTALL_DIR="$1"
                ;;
            --install-dir=*)
                CAPA_INSTALL_DIR="${arg#*=}"
                ;;
            *)
                err "unknown option: $arg (use --help for usage)"
                ;;
        esac
    done
}

# Entry point
main() {
    parse_args "$@"
    install_capa
}

main "$@"
