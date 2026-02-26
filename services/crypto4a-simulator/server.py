#!/usr/bin/env python3
"""
Crypto4A QRNG Simulator
Simulates quantum random number generation for development/testing.
In production, this would connect to actual Crypto4A HSM hardware.
"""

import os
import secrets
import time
from flask import Flask, jsonify, request

app = Flask(__name__)

# Statistics
stats = {
    'requests': 0,
    'bytes_generated': 0,
    'start_time': time.time()
}


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'service': 'crypto4a-qrng-simulator',
        'uptime_seconds': int(time.time() - stats['start_time']),
        'requests_served': stats['requests'],
        'total_bytes_generated': stats['bytes_generated']
    })


@app.route('/v1/random', methods=['GET'])
def get_random():
    """
    Get quantum random bytes.

    Query Parameters:
        length: Number of bytes to generate (default: 32, max: 1024)

    Returns:
        JSON with random_bytes as list of integers
    """
    length = request.args.get('length', default=32, type=int)

    # Limit to prevent abuse
    if length < 1:
        length = 1
    if length > 1024:
        length = 1024

    # Generate cryptographically secure random bytes
    # In production, this would come from Crypto4A QRNG hardware
    random_bytes = list(secrets.token_bytes(length))

    # Update stats
    stats['requests'] += 1
    stats['bytes_generated'] += length

    return jsonify({
        'random_bytes': random_bytes,
        'length': length,
        'source': 'crypto4a-simulator',
        'timestamp': int(time.time() * 1000),
        'entropy_quality': 'simulated'  # Would be 'quantum' in production
    })


@app.route('/v1/random/hex', methods=['GET'])
def get_random_hex():
    """Get quantum random bytes as hex string."""
    length = request.args.get('length', default=32, type=int)

    if length < 1:
        length = 1
    if length > 1024:
        length = 1024

    random_hex = secrets.token_hex(length)

    stats['requests'] += 1
    stats['bytes_generated'] += length

    return jsonify({
        'random_hex': random_hex,
        'length': length,
        'source': 'crypto4a-simulator',
        'timestamp': int(time.time() * 1000)
    })


@app.route('/v1/status', methods=['GET'])
def status():
    """Get QRNG status and statistics."""
    return jsonify({
        'status': 'operational',
        'mode': 'simulator',
        'hardware': {
            'model': 'Crypto4A QxEDGE (Simulated)',
            'serial': 'SIM-2026-001',
            'firmware': '1.0.0-sim'
        },
        'statistics': {
            'uptime_seconds': int(time.time() - stats['start_time']),
            'total_requests': stats['requests'],
            'total_bytes': stats['bytes_generated'],
            'entropy_rate_bps': 1000000  # Simulated rate
        },
        'note': 'This is a simulator for development. Production uses actual Crypto4A QRNG hardware.'
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8106))
    print(f"Starting Crypto4A QRNG Simulator on port {port}")
    print("WARNING: This is a simulator for development/testing only.")
    print("Production deployments should use actual Crypto4A hardware.")
    app.run(host='0.0.0.0', port=port, debug=False)
