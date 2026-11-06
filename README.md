# Wallet Map

Explore wallet relationships on Ethereum and Base through an interactive graph, then open the transfers behind each connection.

Wallet Map supports live address searches, progressive expansion, token and date filters, two-wallet comparison, notes, local saves, JSON import/export, and CSV evidence exports. It reads public chain history through Alchemy. Users do not connect a wallet or sign transactions.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
```

Copy `.env.example` to `.env.local`. Set `ALCHEMY_API_KEY` to an Alchemy application key with access to the networks you want to explore. Generate `APP_SIGNING_SECRET` with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep both values in `.env.local`. Then start the app:

```sh
npm run dev
```

Open [localhost:3100](http://127.0.0.1:3100). An explicitly labeled sample investigation is available without credentials. Live searches require the key.

## Investigate a wallet

1. Paste a wallet address and select the network used in your wallet: Ethereum Mainnet, Base Mainnet, Ethereum Sepolia, or Base Sepolia. Choose a 7-, 30-, or 90-day period, or custom UTC dates up to 90 days apart. The custom end date is exclusive.
2. Choose ETH and tokens, ETH only, or a specific ERC-20 contract, then select **Explore wallet**.
3. Select an address to expand its neighborhood. Select an arrow to inspect its transfers and transaction links. Table view provides the same selection actions through buttons.
4. Use **Compare wallet** to load a second starting address at the same snapshot. Shared counterparties are calculated from loaded history, including counterparties hidden by the initial display limit.
5. Add address notes and save the investigation in this browser. Export JSON for a portable copy or CSV for the filtered, loaded transfer records.

The graph initially reveals up to 20 counterparties per expanded address. **Reveal more loaded counterparties** changes what is visible without fetching more history. **Load older / retry** requests additional pages. Hiding a node changes presentation; it does not delete fetched evidence. Undo restores the previous graph action. Pinning preserves a node through collapse.

Each investigation uses a fixed finalized block on one network. The same address can have different history on different networks. All neighborhoods, balance reads, and explorer links use the selected network. Testnet investigations are labeled separately. Start a new search to refresh or switch networks. Live query tokens expire after 24 hours; history continuation tokens expire after eight minutes. Restart an address to refetch at the same snapshot when its continuation expires.

## Understand the coverage

- The current release includes successful external ETH transfers and ERC-20 transfer events on the four supported networks. External ETH transfers are checked against transaction receipts. Raw integer token amounts are retained and calculated with BigInt.
- Internal ETH transfers, NFTs, approvals, zero-value calls, failed transactions, rewards, and cross-chain bridge tracing are excluded. A lack of matching transfers does not establish that an address has no other activity.
- New searches fetch up to 50 records per direction per page. Existing continuation tokens keep their page size. Per-address limits are 1,000 records per direction. An investigation holds up to 10,000 unique transfers and displays up to 100 addresses and 300 connections.
- Partial history and direction failures are shown explicitly. Counts, rankings, comparisons, and totals describe loaded records. Different assets are never summed together. Unknown amounts remain unknown.
- Token symbols are unverified metadata. A reported token event does not prove that a user initiated it or that the token has economic value. A shared counterparty does not prove shared ownership. A graph path does not identify the path of particular funds.
- The sample investigation contains fictional, illustrative records. It does not link them to real transaction evidence.

JSON exports omit signed query and continuation tokens. Imported JSON opens as a saved snapshot and remains usable offline after the app has loaded. Start a new live search to continue fetching an imported investigation. Browser saves retain their live tokens until expiry. Clearing browser storage removes local saves; JSON exports provide a backup.

Searches are sent to this app server and Alchemy. Notes and saved investigations stay in the browser. No raw address-search or note analytics are implemented.

## Verify changes

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

The browser tests use installed Microsoft Edge on Windows. On other systems they use Playwright Chromium; install it with `npx playwright install chromium`. Tests cover the sample workflow, evidence selection, comparison, saving/restoring, JSON export/import, input validation, and the mobile table.

Live smoke tests are opt-in and use the local Alchemy configuration:

```powershell
$env:LIVE_SMOKE='true'
npm run test:e2e
```

Unit tests cover event deduplication, exact amount arithmetic, filters, shared counterparties, import validation, CSV escaping, signed-token tampering, and receipt-based exclusion of failed ETH transfers. CI runs the offline checks without secrets.

## Deploy the app

Import this personal repository into Vercel as a Next.js project. Set these server environment variables:

| Variable                   | Purpose                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ALCHEMY_API_KEY`          | Provider access for the networks you want to search.                                                 |
| `APP_SIGNING_SECRET`       | Stable random secret for signed snapshot and continuation tokens.                                    |
| `UPSTASH_REDIS_REST_URL`   | Shared cache and quota store URL.                                                                    |
| `UPSTASH_REDIS_REST_TOKEN` | Shared store credential.                                                                             |
| `PROVIDER_DAILY_BUDGET`    | Maximum provider RPC methods per UTC day; default 10,000. Set this to match your provider allowance. |

Production live searches require Redis. Shared rate limits allow 20 app requests per minute per client, with an atomic global daily RPC budget. Retries and batched receipt reads consume the provider budget. Set Vercel's regional configuration to match Redis and review provider/hosting spend limits before public use.

For a single-instance local production preview only, `ALLOW_LOCAL_LIMITS=true npm start` enables in-memory quotas. In PowerShell, set `$env:ALLOW_LOCAL_LIMITS='true'` before `npm start`. This override is unsuitable for a public multi-instance deployment.

All secrets are server-only and `.env.local` is ignored by Git. Do not prefix secrets with `NEXT_PUBLIC_`.

## Structure

- `src/components/`: interactive explorer, Cytoscape graph, evidence panel, and table.
- `src/lib/domain.ts`: validated records, exact arithmetic, deduplication, aggregation, and graph projection.
- `src/lib/server/`: provider integration, signed tokens, snapshots, caching, and quotas.
- `src/lib/storage.ts`: IndexedDB saves and downloads.
- `src/app/api/`: snapshot, neighborhood, and balance endpoints.
- `tests/`: domain/provider tests and browser workflows.

The [implementation plan](IMPLEMENTATION_PLAN.md) describes the intended product and later milestones. Current coverage and behavior are documented above. Additional networks, internal ETH verification, sourced labels, team accounts, alerts, and AI graph queries remain future work.
