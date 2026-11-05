# Wallet Map: implementation plan

Status: the first implementation is available. See README.md for current behavior, setup, and verified coverage. Internal ETH remains deferred; the current release covers external ETH and ERC-20 events. The interface uses plain CSS. The plan below retains the intended roadmap.

## 1. Build an explorer that answers concrete questions

Paste an Ethereum address, inspect its transfers, and expand connected addresses into an interactive graph. Every connection opens the records that support it.

The first release helps someone answer:

- Which addresses sent funds to this address, and which received funds from it?
- Which connections recur within a selected period?
- What activity is visible when I expand a recipient or sender?
- Do two addresses have shared counterparties in the records I have loaded?
- Can I save this investigation and export its evidence?

The intended first users are people who already investigate wallet activity across multiple explorer tabs. Their willingness to pay remains untested. The first product test is whether this app helps them finish a real investigation faster.

This is a blockchain data application. Its server reads public chain data through an indexer. Users need an address, not a connected wallet. This release requires no Solidity contract, signatures, gas, or private company data.

## 2. Make exploration useful and readable

| Interaction | Required behavior |
| --- | --- |
| Paste an address | Validate it, load recent activity, and place the address at the center. |
| Click an address | Open a panel with its full address, observed activity, notes, and Expand action. Fetch its ETH balance on demand. |
| Click a connection | Show direction, separate totals for each asset, timestamps, and individual transfers with explorer links. |
| Expand an address | Load one additional neighborhood. Keep existing nodes in place. Never expand other addresses automatically. |
| Filter activity | Choose a time range, asset, direction, and optionally a minimum transfer amount for one asset. |
| Compare another address | Pin a second starting address and highlight shared counterparties in loaded data. |
| Reduce clutter | Pin, hide, undo, or collapse an expansion. Reveal additional counterparties on request. |
| Save work | Save locally with notes and layout. Export and import a portable investigation file. |

Use a desktop layout with a compact toolbar, a large graph, and a right-side evidence panel. Include a synchronized table view for keyboard access and smaller screens. Show a legend for arrows, the starting addresses, and selected nodes.

The toolbar always shows the network, date range, snapshot time, and loading coverage. Example wording: “500 transfers loaded; older results remain.” An empty search says “No matching transfers in this range,” not “This wallet has never been used.”

A short summary uses calculations from loaded records, such as “12 counterparties across 86 transfers.” It requires no AI model.

## 3. Set a firm first-release scope

| Decision | First release |
| --- | --- |
| Network | Ethereum mainnet, chain ID 1. Keep the chain ID in every data identifier. |
| Input | A hexadecimal Ethereum address. ENS lookup can follow later. |
| Transfer coverage | External ETH, ERC-20 transfer events, and provider-supported internal ETH transfers, subject to the data validation in stage 1. |
| Dates | Last 30 days by default; 7-day, 30-day, and 90-day presets; custom ranges up to 90 days. |
| Freshness | A fixed finalized block for each investigation. Refresh creates a new snapshot. |
| Graph size | Up to 100 visible address nodes and 300 directed connections. |
| Expansion | Initially reveal up to 20 counterparties per expanded address, ranked by loaded transfer count. |
| History loading | Fetch up to 250 inbound and 250 outbound records per load action. |
| History budget | Up to 2,000 records per expanded address and 10,000 unique records per investigation. At a cap, offer narrower dates or an asset filter. |
| Asset amounts | Exact token quantities. No dollar prices or combined totals across different assets. |
| Address details | Full address, ETH balance at the snapshot, observed activity, explorer link, and user notes. |
| Saving | Browser storage and JSON export/import. CSV export of matching loaded transfers. |
| Accounts | Anonymous use. No signup or cloud synchronization. |

Ethereum is the initial implementation choice because the selected provider documents the required transfer categories there. The provider also supports other chains, including Base; additional networks can use the same adapter later. [Alchemy transfer endpoint](https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers)

An address history and an address identity are different things. This release does not claim to identify a wallet's owner. Shared counterparties do not establish shared ownership. A path through addresses does not prove that the same funds passed along the path.

## 4. Use one application and a small stack

| Layer | Choice | Purpose |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript | UI and server API in one project. |
| Styling | Tailwind CSS | Responsive toolbar, graph controls, panels, and tables. |
| Graph | Cytoscape.js | Graph rendering, selection, arrows, layouts, and neighborhood highlighting. |
| Client state | React reducer and normalized maps | Keep fetched records separate from graph presentation. |
| Chain reads | Alchemy Transfers API plus viem for Ethereum RPC | Historical transfers, blocks, and balance reads. |
| Validation | Zod | Validate API requests, provider responses, and imported files. |
| Local persistence | IndexedDB through idb | Save investigations, notes, records, and node positions. |
| Hosted cache and quotas | Upstash Redis | Share cached pages and request limits across server instances. |
| Hosting | Vercel | Deploy the Next.js application. |
| Verification | Vitest and Playwright | Check data correctness and complete browser workflows. |

Next.js route handlers provide the server endpoints. Cytoscape supports explicit positions, so expansions can preserve the user's layout. IndexedDB stores structured data locally. [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Cytoscape.js](https://js.cytoscape.org/), [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

Use a bounded in-memory cache for local development. Require shared quotas for the public deployment. Upstash supports both per-identifier limits and a global limit; Vercel supports deployment of the Next.js app. [Upstash rate limits](https://upstash.com/docs/redis/sdks/ratelimit-ts/features), [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)

Pin compatible package versions and commit the lockfile when implementation begins. No graph database, separate Python service, or model training is needed for this release.

## 5. Model facts separately from the picture

The knowledge graph consists of addresses, assets, transfers, and sourced relationships. The main canvas projects these facts into address nodes and transfer connections. Transaction and asset details live in the evidence panel to avoid crowding the graph.

| Record | Required fields |
| --- | --- |
| Address | ID formed from chain ID and lowercase address; checksummed display address. |
| Asset | Chain ID; native-asset marker or token contract address; optional symbol and decimals. |
| Transfer | Chain ID; provider unique ID; transaction hash; block number; timestamp; sender; recipient; category; asset ID; raw integer amount or explicit unknown; source. |
| Connection | Ordered sender/recipient pair; unique transfer IDs; counts; totals grouped by asset; first and last observed times. |
| Coverage | Address; exact query parameters; snapshot; incoming and outgoing states; loaded counts; continuation state; errors or budget limits. |
| Investigation | Schema version; starting addresses; query; snapshot; normalized records; expansion actions; positions; pinned and hidden nodes; notes. |

Use chain ID plus the provider's unique transfer ID for deduplication. A transaction hash alone is insufficient because one transaction can contain several transfers. Preserve each transfer's category and source. Validate that event IDs remain stable across pagination and opposite-direction queries in stage 1.

Store raw amounts as decimal strings and calculate with BigInt. Use decimals only for formatting. Never sum the provider's floating-point display values. Unknown amounts or decimals stay unknown. Identify tokens by contract address because symbols can repeat or mislead.

One directed connection represents all loaded transfers from A to B. B to A is a separate connection. Display per-asset totals in the panel. Distinguish transfer count from distinct transaction count.

Treat the zero address as a mint/burn endpoint, not a person. Preserve self-transfers without counting them twice. Token transfer events are reported contract events, not guarantees that a token has financial value or that a user initiated a transfer.

## 6. Fetch bounded, reproducible history

1. Validate the address and date range on the server. The server selects the network endpoint; clients cannot supply arbitrary RPC URLs.
2. Read the finalized block number, hash, and timestamp. Resolve the requested dates to inclusive block bounds with cached block lookups and binary search. Use a UTC start-inclusive, end-exclusive time interval.
3. Return a signed query token containing the chain, block bounds, end-block hash, asset selection, and expiry. All expansions use this same query. viem supports reading the finalized block tag. [viem getBlock](https://viem.sh/docs/actions/public/getBlock)
4. Query inbound and outbound history separately with Alchemy. Use fixed block bounds, descending order, timestamps, and the supported transfer categories. Do not set both fromAddress and toAddress to the same wallet.
5. Fetch at most one page per direction per action. Request 250 records per page. An ERC-20 filter uses its contract address; the native-asset filter uses ETH categories.
6. Normalize and merge records by transfer ID. Return per-direction completion states and signed continuation tokens bound to the query and address. Preserve the successful direction if the other request fails.
7. Build connections from unique loaded records after applying display filters. Reveal the top 20 counterparties by count, with recency and address as deterministic tie-breakers. Say “most frequent in loaded data” when history is incomplete.
8. Load older pages only when requested. Enforce the remaining per-address and investigation budgets. If a page crosses a budget, mark it truncated and require a narrower query rather than silently claiming completion.
9. Refresh into a new investigation snapshot. Preserve notes and pins where addresses still exist, but do not mix transfers from different snapshots.

Alchemy's history API avoids scanning the chain ourselves. Its pagination keys expire after 10 minutes. [Alchemy history and pagination](https://www.alchemy.com/docs/reference/transfers-api-quickstart)

Do not store provider continuation keys in saved investigations. When a key expires, offer to restart that address's query at the same snapshot. Clear its paging state, refetch within the same budgets, and deduplicate against saved records. Do not silently skip to an older block: multiple transfers can share a block.

Cache keys include the chain, address, block bounds, snapshot hash, categories, direction, asset selection, and page. Cache completed page data for up to 24 hours; expire cursor-bearing pages before their cursor expires. Bound local cache memory to 50 MB and coalesce identical in-flight requests.

Retry only transient failures, at most twice, with backoff and respect for Retry-After. Limit an action to 20 seconds and return a recoverable error or partial result. Abort stale client requests and reject late responses using an investigation generation ID.

Before public release, enforce per-client request limits and an atomic global daily provider-request budget in Redis. Count retries and RPC calls as well as history calls. Set the global budget from the actual provider plan and measured usage. If quota storage fails, block new upstream calls while allowing saved investigations to open.

## 7. Define small server endpoints

| Endpoint | Request | Response |
| --- | --- | --- |
| POST /api/snapshot | Address, date range, optional asset | Normalized address, signed query token, snapshot block/hash/time, supported coverage. |
| POST /api/neighborhood | Address, query token, optional continuation token | Normalized transfer page, per-direction coverage, continuation tokens, warnings. |
| POST /api/address | Address and query token | ETH balance at the snapshot or a specific unavailable/error state. |

Connection details, summaries, comparison, and exports operate on loaded records in the browser. They do not trigger hidden history requests.

Keep the Alchemy key and token-signing secret on the server. Validate signed-token expiry and all resource limits server-side. Redact credentials from error logs and use fixed explorer URL templates. Render token metadata and notes as text. Escape CSV fields and neutralize spreadsheet formula prefixes in text fields.

Use distinct states for invalid input, missing configuration, no activity, partial history, expired continuation, upstream throttling, and upstream failure. Missing credentials must produce a setup message. Generated sample data must never appear as live results.

Do not log raw wallet searches or notes by default. Browser saves remain on that browser; explain that clearing browser storage removes them, and offer export. Queries necessarily reach the app server and its data provider.

## 8. Keep graph actions predictable

- Keep normalized transfer data as the source of truth. Recompute aggregates from unique matching records instead of incrementing totals on each response.
- Track which expansion actions reveal which nodes. Collapsing one expansion preserves pinned addresses and nodes revealed by another active expansion.
- Keep hidden nodes separate from fetched records. Hiding a node changes presentation, not the historical facts.
- Position new nodes around the expanded address. Move existing nodes only when the user selects Arrange.
- Apply graph limits after aggregation. Report loaded-but-hidden counterparties separately from history that has not been fetched.
- Apply direction filters relative to the selected starting address or expanded address. Arrow directions always retain their actual sender-to-recipient meaning.
- Apply minimum amount per transfer and only when one asset is selected. Show that totals reflect the filtered records; report unknown amounts separately.
- Narrowing dates or changing the asset starts a fresh query while retaining notes. An amount filter can operate locally on loaded records.
- Compare two pinned addresses using their loaded direct-counterparty sets, including records hidden by the display cap. Reveal selected shared counterparties when space permits. Explain “none found in loaded data” rather than claiming the wallets are unrelated.
- Imported investigations open as saved snapshots. Validate their schema, counts, string lengths, identifiers, and a 10 MB file-size limit. Never execute imported content or trust imported continuation state.

## 9. Implement in six stages

Complete each stage's acceptance checks before moving to the next.

| Stage | Build | Acceptance check |
| --- | --- | --- |
| 1. Prove the data path | Project skeleton, server configuration, Alchemy adapter, snapshot resolver, normalization, fixture capture. | Compare external ETH, ERC-20, and internal ETH examples against transaction evidence. Verify exact amounts, stable IDs, pagination, self-transfers, and failed/reverted behavior. |
| 2. Ship one useful investigation | Address form, initial neighborhood, graph, table view, connection panel, coverage display. | Paste a real address, see its connections, and open the exact supporting transfers. Validate empty, invalid, missing-key, and provider-error states. |
| 3. Support deeper exploration | Expansion, paging, stable layout, filters, pins, hide/collapse, undo, and caps. | Explore A to B to C; expand B twice without duplicates; collapse B without losing independently revealed nodes. All visible totals match filtered records. |
| 4. Add comparison and persistence | Second starting address, shared-counterparty highlights, notes, local saves, JSON import/export, CSV export. | Compare a fixture with known shared counterparties. Reload and restore the same graph. Export/import retains evidence, notes, coverage, and layout. |
| 5. Prepare public use | Shared cache and quotas, timeout/retry handling, request cancellation, keyboard support, responsive table and panel. | Expired cursors and throttling recover cleanly. Two server instances respect the same budget. Test 100 nodes, 300 connections, and 10,000 records without losing interactions. |
| 6. Deploy and verify | Vercel configuration, environment variables, setup README, live smoke checks, usage metrics. | A new browser completes search, expansion, evidence inspection, comparison, save, and export on the hosted app. No credentials appear in client assets or responses. |

Stage 1 is a release gate for transfer categories. A reverted parent transaction or reverted internal call must not create a successful-transfer connection. If provider behavior is insufficient, add cached receipt/trace checks for the affected category or explicitly exclude that category until supported. Do not advertise coverage that has not passed this check.

Before calling the release usable, observe three people use it on a wallet question they already have. Check whether they can find the supporting transfers, understand incomplete coverage, and export a result without guidance. Record where they get stuck before adding features.

## 10. Organize the implementation by responsibility

These are planned files, not existing source files:

| Path | Responsibility |
| --- | --- |
| src/app/page.tsx | Explorer entry page. |
| src/app/api/{snapshot,neighborhood,address}/route.ts | Request validation, quotas, and server responses. |
| src/components/explorer/ | Search, graph, filters, evidence panel, comparison, and table components. |
| src/lib/server/alchemy.ts | Provider calls and provider-response validation. |
| src/lib/server/snapshot.ts | Date/block resolution and snapshot tokens. |
| src/lib/server/cache.ts | Bounded local cache and hosted Redis cache. |
| src/lib/server/limits.ts | Request limits and global upstream budget. |
| src/lib/domain/ | Transfer normalization, IDs, exact amounts, aggregation, filters, and comparison. |
| src/lib/investigation/ | Reducer, expansion provenance, persistence, and export/import. |
| tests/fixtures/ | Sanitized provider responses with query context and expected results. |
| tests/e2e/ | Browser workflows and failure scenarios. |

Keep server imports out of browser modules. Keep domain calculations independent of React and the provider SDK so they can be tested with recorded evidence.

## 11. Verify the facts users rely on

Use focused automated checks for:

- Duplicate pages and the same transfer discovered from both endpoints.
- Multiple transfers in one transaction, cycles, self-transfers, and mint/burn endpoints.
- Large integer amounts, different token decimals, duplicate symbols, and missing metadata.
- Failed transactions and reverted internal activity in the supported coverage.
- One failed direction, cursor expiry, retries, query changes, and stale responses.
- Partial-history labels and totals that match the exact displayed evidence.
- Shared-counterparty results when some relevant nodes are hidden.
- Save/restore, invalid imports, CSV escaping, and local-storage failure.

Run type checking, linting, domain tests, browser tests, and the production build. Use recorded fixtures for repeatable automated checks and a small live smoke test for provider compatibility. Fixtures are for development and tests; production searches use live indexed data.

## 12. Prepare credentials and defer later features

For local live-data development, provide an Alchemy application key with Ethereum mainnet access through .env.local. Generate an application signing secret locally. No wallet private key is required.

For the hosted release, configure the Alchemy key, signing secret, Upstash Redis URL/token, and provider-request budget in Vercel. Include an .env.example containing variable names and descriptions only. Check actual provider and hosting allowances before choosing a paid plan; this plan makes no promise of unlimited free use.

Keep these features for later releases:

- Base and other networks, followed by explicit bridge support.
- NFTs, zero-value contract calls, approvals, and full transaction decoding.
- Sourced identity labels, ENS, and complete token portfolio balances.
- Cloud accounts, shared investigation links, team workspaces, and alerts.
- Larger historical searches with background jobs and a durable transfer database.
- Natural-language questions translated into bounded graph queries, with links to the evidence.

Model training is a separate decision that needs a task, labeled examples, and an evaluation set. A graph database becomes useful if server-side investigations outgrow bounded in-memory queries. Neither is a prerequisite for the useful explorer described here.

Potential paid features are saved team investigations, monitored addresses, larger history budgets, and scheduled evidence exports. Validate repeat usage before adding billing.

The first implementation milestone is stage 2: paste a real address, inspect a readable graph, and verify every displayed connection through its underlying transfers.
