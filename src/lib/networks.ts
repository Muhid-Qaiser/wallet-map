import { z } from "zod";

export const chainIds = [1, 8453, 11155111, 84532] as const;
export const chainIdSchema = z.literal(chainIds);
export type ChainId = z.infer<typeof chainIdSchema>;

export const networks = {
  1: {
    name: "Ethereum Mainnet",
    testnet: false,
    alchemy: "eth-mainnet",
    explorer: "https://etherscan.io",
    explorerName: "Etherscan",
  },
  8453: {
    name: "Base Mainnet",
    testnet: false,
    alchemy: "base-mainnet",
    explorer: "https://basescan.org",
    explorerName: "BaseScan",
  },
  11155111: {
    name: "Ethereum Sepolia",
    testnet: true,
    alchemy: "eth-sepolia",
    explorer: "https://sepolia.etherscan.io",
    explorerName: "Etherscan",
  },
  84532: {
    name: "Base Sepolia",
    testnet: true,
    alchemy: "base-sepolia",
    explorer: "https://sepolia.basescan.org",
    explorerName: "BaseScan",
  },
} satisfies Record<
  ChainId,
  {
    name: string;
    testnet: boolean;
    alchemy: string;
    explorer: string;
    explorerName: string;
  }
>;
