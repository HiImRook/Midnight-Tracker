# CHANGELOG

## [v0.1.2] - 2026-03-11
### Changed
- Switched Cardano data source from Koios to Blockfrost to resolve CORS blocking on GitHub Pages
- Blockfrost key and Midnight RPC entered in UI — never stored in files or committed to repo
- Key and RPC persist in sessionStorage across refresh, cleared on tab close or manual stop

### Fixed
- BigInt/Number type mismatch in DUST amount calculations
- registerCardanoEvent argument count mismatch

## [v0.1.1] - 2026-03-10
### Fixed
- Capped Midnight WebSocket reconnect attempts to prevent endpoint hammering on unavailable testnet
- Cleaned Koios fetch headers for proper CORS handling from GitHub Pages origin

## [v0.1.0] - 2026-03-09
### Added
- Initial release
- Live client-side dashboard — no server or databases, fully in-memory
- Cardano NIGHT policy ID watcher via Koios REST
- Midnight testnet-02 WebSocket connection via Substrate RPC
- Four-vector correlation engine: registration link, timing delta, amount match, pattern fingerprint
- Confidence scoring with HIGH/MEDIUM/LOW/NONE thresholds
- Live correlation map, table, and feed
- GitHub Pages deployment
