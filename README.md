# Contraband Protocol

Contraband Protocol is a hidden-cargo bluffing game for the Inco Summer Game Jam.
A shipper receives a private cargo card, declares a public manifest, and an
inspector decides whether to pass the shipment or break the seal. If the cargo is
inspected, Inco reveals the encrypted handle and the contract settles the pot
from an attested value.

The project is built from Inco's `confidential-deck-template` and keeps the
official examples in `contracts/examples/` for reference. The jam game lives in:

- `contracts/ContrabandProtocol.sol`
- `ignition/modules/ContrabandProtocol.ts`
- `frontend/app/page.tsx`

Live web build: https://contraband.polkahub.xyz

Base Sepolia contract:
`0x098825B008C60EA3A5ab5422dA1e71E2D1f047c5`

## Game Loop

1. Shipper calls `openManifest()` with the stake.
2. `ConfidentialDeck` shuffles a 24-item cargo deck and privately deals one
   cargo to the shipper with `_dealTo`.
3. Inspector joins the room with the same stake.
4. Shipper declares `Clean`, `Contraband`, or `Artifact`.
5. Inspector either calls `pass()` and the shipper wins without reveal, or calls
   `inspect()` to make the cargo public.
6. `settle()` verifies the revealed value with Inco covalidator signatures. A
   truthful manifest pays the shipper; a false manifest pays the inspector.

Cargo distribution:

- values `1..12`: clean cargo
- values `13..20`: contraband
- values `21..24`: artifact

## Why Inco Matters

The game only works if the shipper can privately see a cargo value while the
inspector cannot. The contract stores only an encrypted handle until the
inspector chooses to reveal it. Settlement uses `_verifyValue`, so a player
cannot substitute a value from another cargo handle.

## Local Setup

```bash
npm install
npm run compile

cd frontend
npm install
npm run build
```

## Deploy to Base Sepolia

Create `.env` in the repository root:

```bash
PRIVATE_KEY_BASE_SEPOLIA=
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

Deploy and wire the frontend:

```bash
npm run deploy:contraband:testnet
npm run wire:frontend
```

Then add a WalletConnect project id in `frontend/.env.local`:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_CONTRABAND_ADDRESS=0x...
```

## Run the Web Game

```bash
cd frontend
npm run dev
```

The first screen is the game itself. It includes a live wallet table and a demo
scanner panel for recording a quick video without needing a second wallet.
