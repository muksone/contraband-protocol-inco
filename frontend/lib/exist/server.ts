import { Lightning } from "@inco/lightning-js/lite";
import { bytesToHex, createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import contrabandAbi from "@/abi/ContrabandProtocol.json";

export const runtime = "nodejs";

const CLAIMS = ["Clean cargo", "Contraband", "Artifact"] as const;
const STATES = ["Open", "Dealt", "Claimed", "Inspecting", "Done"] as const;

type RoomRaw = [string, string, number, number, boolean, number, number, bigint];

const NETWORK = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";
const chain = NETWORK === "mainnet" ? base : baseSepolia;
const fallbackRpc = NETWORK === "mainnet" ? "https://mainnet.base.org" : "https://base-sepolia-rpc.publicnode.com";
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || fallbackRpc;
const contractAddress = process.env.NEXT_PUBLIC_CONTRABAND_ADDRESS as `0x${string}` | undefined;
const abi = contrabandAbi;

function privateKey() {
  const raw = process.env.EXIST_AI_PRIVATE_KEY || process.env.PRIVATE_KEY_BASE_SEPOLIA;
  if (!raw) throw new Error("EXIST_AI_PRIVATE_KEY is not set");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

export function getAiAccount() {
  return privateKeyToAccount(privateKey());
}

export function getPublicClient() {
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function getWalletClient() {
  const account = getAiAccount();
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

export function getContractAddress() {
  if (!contractAddress) throw new Error("NEXT_PUBLIC_CONTRABAND_ADDRESS is not set");
  return contractAddress;
}

export async function getStake() {
  return (await getPublicClient().readContract({
    address: getContractAddress(),
    abi,
    functionName: "stake",
  })) as bigint;
}

export async function getRoom(roomId: bigint) {
  const raw = (await getPublicClient().readContract({
    address: getContractAddress(),
    abi,
    functionName: "roomOf",
    args: [roomId],
  })) as unknown as RoomRaw;
  return serializeRoom(roomId, raw);
}

export async function waitForRoom(
  roomId: bigint,
  predicate: (room: Awaited<ReturnType<typeof getRoom>>) => boolean,
) {
  let room = await getRoom(roomId);
  for (let i = 0; i < 8 && !predicate(room); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    room = await getRoom(roomId);
  }
  return room;
}

export async function getBotStatus() {
  const account = getAiAccount();
  const publicClient = getPublicClient();
  const [balance, stake, payout] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    getStake(),
    publicClient.readContract({
      address: getContractAddress(),
      abi,
      functionName: "payout",
      args: [account.address],
    }) as Promise<bigint>,
  ]);
  return {
    address: account.address,
    balanceWei: balance.toString(),
    balanceEth: formatEther(balance),
    payoutWei: payout.toString(),
    payoutEth: formatEther(payout),
    stakeWei: stake.toString(),
    stakeEth: formatEther(stake),
    hasGemini: Boolean(process.env.GEMINI_API_KEY),
  };
}

function cargoType(value: number | bigint) {
  const v = Number(value);
  if (v <= 12) return 0;
  if (v <= 20) return 1;
  return 2;
}

function serializeRoom(roomId: bigint, raw: RoomRaw) {
  const [shipper, inspector, claim, actual, wasInspected, winner, state, pot] = raw;
  return {
    roomId: roomId.toString(),
    shipper,
    inspector,
    claim,
    claimLabel: CLAIMS[claim] ?? "Unknown",
    actual,
    actualLabel: actual > 0 || state === 4 ? CLAIMS[actual] ?? "Unknown" : "Sealed",
    wasInspected,
    winner,
    winnerLabel: winner === 0 ? "shipper" : winner === 1 ? "inspector" : "unset",
    state,
    stateLabel: STATES[state] ?? "Unknown",
    potWei: pot.toString(),
    potEth: formatEther(pot),
  };
}

export async function writeAiTx(functionName: string, args: unknown[] = [], value?: bigint) {
  const hash = await getWalletClient().writeContract({
    address: getContractAddress(),
    abi,
    functionName,
    args,
    value,
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return { hash, receiptStatus: receipt.status };
}

export async function chooseAiAction(room: Awaited<ReturnType<typeof getRoom>>) {
  const fallback = fallbackDecision(Number(room.roomId), room.claim);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallback;

  try {
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const prompt = [
      "You are the AI customs inspector in Contraband Protocol.",
      "The cargo is private. You only know the public manifest and room state.",
      "Choose whether to inspect the sealed cargo or pass it.",
      "Return strict JSON only: {\"action\":\"inspect\"|\"pass\",\"reason\":\"short reason\"}.",
      `Room: ${room.roomId}`,
      `Manifest: ${room.claimLabel}`,
      `Pot: ${room.potEth} ETH`,
      "Strategy: be suspicious, but do not inspect every shipment.",
    ].join("\n");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(text || "{}") as { action?: string; reason?: string };
    const action = parsed.action === "pass" ? "pass" : "inspect";
    return {
      action,
      reason: parsed.reason || fallback.reason,
      source: "gemini",
    };
  } catch {
    return { ...fallback, reason: `${fallback.reason} Gemini unavailable, used fallback strategy.` };
  }
}

function fallbackDecision(roomId: number, claim: number) {
  const baseRisk = claim === 0 ? 42 : claim === 1 ? 68 : 58;
  const roll = (roomId * 37 + claim * 19 + 23) % 100;
  const action = roll < baseRisk ? "inspect" : "pass";
  const reason =
    action === "inspect"
      ? `${CLAIMS[claim]} manifest risk score ${baseRisk}%, scanner authorized.`
      : `${CLAIMS[claim]} manifest risk score ${baseRisk}%, shipment cleared to preserve margin.`;
  return { action, reason, source: "fallback" };
}

export async function revealCargoForSettle(roomId: bigint) {
  const publicClient = getPublicClient();
  const handle = (await publicClient.readContract({
    address: getContractAddress(),
    abi,
    functionName: "cargoHandle",
    args: [roomId],
  })) as Hex;
  const zap = NETWORK === "mainnet" ? await Lightning.baseMainnet() : await Lightning.baseSepoliaTestnet();

  let lastError: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      const [revealed] = await zap.attestedReveal([handle]);
      return {
        value: BigInt(revealed.plaintext.value),
        sigs: revealed.covalidatorSignatures.map((sig: Uint8Array) => bytesToHex(sig)),
        cargoType: cargoType(BigInt(revealed.plaintext.value)),
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Public reveal is not ready");
}
