#!/bin/bash
# QuantumHarmony Node Operator Setup
# Installs QSSH and generates quantum-safe keys

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         QuantumHarmony Node Setup                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check for Rust/Cargo
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust not found. Installing..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Check for QSSH
if command -v qssh &> /dev/null; then
    echo "✅ QSSH already installed: $(qssh --version 2>/dev/null || echo 'installed')"
else
    echo "📦 Installing QSSH (Quantum-Secure Shell)..."

    QSSH_DIR="/tmp/qssh-install-$$"
    git clone --depth 1 https://github.com/Paraxiom/qssh.git "$QSSH_DIR"
    cd "$QSSH_DIR"

    echo "   Building QSSH (this may take a few minutes)..."
    cargo build --release 2>/dev/null
    cargo install --path . 2>/dev/null

    cd - > /dev/null
    rm -rf "$QSSH_DIR"

    if command -v qssh &> /dev/null; then
        echo "✅ QSSH installed successfully"
    else
        echo "❌ QSSH installation failed"
        exit 1
    fi
fi

# Create QSSH directory
QSSH_KEY_DIR="$HOME/.qssh"
mkdir -p "$QSSH_KEY_DIR"
chmod 700 "$QSSH_KEY_DIR"

# Generate keys if they don't exist
if [ ! -f "$QSSH_KEY_DIR/operator_falcon" ]; then
    echo "🔐 Generating Falcon-512 key pair..."
    if command -v qssh-keygen &> /dev/null; then
        qssh-keygen -t falcon -f "$QSSH_KEY_DIR/operator_falcon" -N "" 2>/dev/null || {
            echo "   (Key generation skipped - run manually: qssh-keygen -t falcon -f ~/.qssh/operator_falcon)"
        }
    fi
else
    echo "✅ Falcon key exists: $QSSH_KEY_DIR/operator_falcon"
fi

if [ ! -f "$QSSH_KEY_DIR/operator_sphincs" ]; then
    echo "🔐 Generating SPHINCS+ key pair..."
    if command -v qssh-keygen &> /dev/null; then
        qssh-keygen -t sphincs -f "$QSSH_KEY_DIR/operator_sphincs" -N "" 2>/dev/null || {
            echo "   (Key generation skipped - run manually: qssh-keygen -t sphincs -f ~/.qssh/operator_sphincs)"
        }
    fi
else
    echo "✅ SPHINCS+ key exists: $QSSH_KEY_DIR/operator_sphincs"
fi

# Check Docker
echo ""
if command -v docker &> /dev/null; then
    echo "✅ Docker installed: $(docker --version)"
else
    echo "❌ Docker not found. Please install Docker first."
    echo "   https://docs.docker.com/get-docker/"
fi

# Summary
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Start local node:                                       ║"
echo "║    ./start.sh                                            ║"
echo "║                                                          ║"
echo "║  Start dashboard only:                                   ║"
echo "║    ./start.sh ui                                         ║"
echo "║                                                          ║"
echo "║  Connect to remote validator (QSSH):                     ║"
echo "║    qssh -L 9944:localhost:9944 user@validator:42         ║"
echo "║                                                          ║"
echo "║  Then enter 'localhost:9944' in dashboard endpoint       ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
