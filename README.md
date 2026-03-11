# Midnight-Tracker

Transparency research tool exposing Midnight Network's boundary metadata leak.

Midnight's shielded zone is cryptographically sound. The boundary is not. Every NIGHT token crossing between Cardano and Midnight is fully public. This tool tracks those crossings, correlates timing, amounts, address ancestry, and registration links, and assigns confidence scores to probabilistically de-anonymize shielded zone activity.

No backend. No server. No database. All state in memory. Closes when you close the tab.

## The Leak This Project Addresses

**Registration Transactions**
Before entering the shielded zone, Midnight requires a registration transaction on Cardano that explicitly maps a Cardano reward address to a Midnight public key. This is a direct, on-chain de-anonymization event visible to anyone watching the chain. It is documented in their own protocol.

**NIGHT Token Visibility**
NIGHT token carries a public policy ID on Cardano. Midnight's own documentation lists its privacy status as "Public (Unshielded)." The bridge mechanism locks NIGHT in a Plutus script on Cardano while Midnight observes and unlocks the equivalent on the shielded side. The lock and unlock events are public.

**Boundary Correlation**
Even without a registration link, the onramp and offramp events carry enough signal to correlate across the boundary. Amount, timing, and behavioral patterns leave fingerprints.

## How It Works

Four correlation vectors weighted and scored per address pair:

- Registration link — direct Cardano address to Midnight pubkey mapping extracted from registration tx (0.80)
- Amount match — burn volume correlated against expected DUST curve from held NIGHT (0.30)
- Timing match — onramp to first burn timing window (0.25)
- Pattern match — burst frequency and regularity fingerprinting (0.20)

Confidence thresholds: HIGH ≥ 0.70 / MEDIUM ≥ 0.40 / LOW ≥ 0.10

## Quick Start

No install. Open `index.html` in a browser.

Get a free API key at [blockfrost.io](https://blockfrost.io). Enter it in the connect panel. It is held in session memory only and clears when you close the tab or click Stop. It is never written to disk.

Midnight RPC defaults to `wss://rpc.testnet-02.midnight.network`. Override it in the UI if needed.

## Status

Tracking testnet-02. Bridge script hash is null until Midnight mainnet deploys the Plutus script. RPC endpoint will swap to mainnet when available.

## Related Projects

- **Valid Blockchain:** https://github.com/HiImRook/accessible-pos-chain
- **Anonymous Memer Bot(Zero Footprint:** https://github.com/Anonymous-Memer-Bot/blob/main/README.md

## License

MIT License — See LICENSE file

Copyright (c) 2026 Rook

---

*You cannot leak what you never kept.*
