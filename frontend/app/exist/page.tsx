"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, Bot, ClipboardCheck, Cpu, ExternalLink, PackageOpen, ScanLine, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { formatEther, zeroAddress, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import contrabandAbi from "@/abi/ContrabandProtocol.json";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Button, Panel, TxBar } from "@/components/ui";
import { useTx } from "@/hooks/useTx";
import { peek, type Revealed } from "@/lib/deck";
import { ADDRESSES, addrUrl, short, txUrl } from "@/lib/games";

const ADDR = ADDRESSES.contraband as `0x${string}` | undefined;
const abi = contrabandAbi;
const CLAIMS = ["Clean cargo", "Contraband", "Artifact"] as const;
const CLAIM_BUTTONS = ["Clean", "Contraband", "Artifact"] as const;
const STATE = ["Open", "Dealt", "Claimed", "Inspecting", "Done"] as const;

type Room = [string, string, number, number, boolean, number, number, bigint];

interface ApiPayload {
  ok: boolean;
  error?: string;
  action?: string;
  skipped?: boolean;
  needsSettle?: boolean;
  decision?: { action: "inspect" | "pass"; reason: string; source: string };
  tx?: { hash: string; receiptStatus: string };
  cargo?: { value: string; type: number };
  bot?: {
    address: string;
    balanceEth: string;
    payoutEth: string;
    stakeEth: string;
    hasGemini: boolean;
  };
}

function cargoType(value: bigint | number) {
  const v = Number(value);
  if (v <= 12) return 0;
  if (v <= 20) return 1;
  return 2;
}

function cargoLabel(value?: bigint | number | null) {
  if (!value) return { code: "SEALED", type: "Unknown cargo", detail: "Encrypted handle only" };
  const v = Number(value);
  const type = cargoType(v);
  const names = [
    "medical gel",
    "water filters",
    "relay batteries",
    "grain cells",
    "cold packs",
    "fiber spools",
    "nav chips",
    "oxygen seals",
    "repair resin",
    "light panels",
    "dock tools",
    "spare valves",
    "signal jammers",
    "ghost keys",
    "black-market cores",
    "cloned passports",
    "counterfeit meds",
    "stolen lenses",
    "unlicensed drones",
    "spoof beacons",
    "pre-collapse idol",
    "oracle shard",
    "sealed relic",
    "ancient drive",
  ];
  return { code: `CARGO-${String(v).padStart(2, "0")}`, type: CLAIMS[type], detail: names[v - 1] };
}

function outcome(claim: number, actual?: number) {
  if (actual === undefined) return "Awaiting verdict";
  return claim === actual ? "Manifest verified" : "False manifest";
}

function stepClass(active: boolean, done: boolean) {
  if (active) return "border-amber-300 bg-amber-300 text-black";
  if (done) return "border-emerald-300 bg-emerald-300/10 text-emerald-100";
  return "border-white/15 bg-black/30 text-white/55";
}

function shortEth(v?: string) {
  if (!v) return "0";
  return Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default function ExistPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [claim, setClaim] = useState(0);
  const [myCargo, setMyCargo] = useState<Revealed | null>(null);
  const [lastApi, setLastApi] = useState<ApiPayload | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [bot, setBot] = useState<ApiPayload["bot"] | null>(null);
  const [lastHash, setLastHash] = useState<string | undefined>();

  const { data: stakeRaw } = useReadContract({ address: ADDR, abi, functionName: "stake", query: { enabled: !!ADDR } });
  const { data: roomCountRaw } = useReadContract({
    address: ADDR,
    abi,
    functionName: "roomCount",
    query: { enabled: !!ADDR, refetchInterval: 5000 },
  });
  const { data: myRoomRaw, refetch: refetchMine } = useReadContract({
    address: ADDR,
    abi,
    functionName: "roomOfPlayer",
    args: [address ?? zeroAddress],
    query: { enabled: !!ADDR && !!address, refetchInterval: 5000 },
  });

  const myRoom = myRoomRaw !== undefined ? Number(myRoomRaw) : -1;
  const hasRoom = myRoom >= 0;
  const rid = BigInt(hasRoom ? myRoom : 0);

  const { data: roomRaw, refetch: refetchRoom } = useReadContract({
    address: ADDR,
    abi,
    functionName: "roomOf",
    args: [rid],
    query: { enabled: !!ADDR && hasRoom, refetchInterval: 3500 },
  });
  const { data: payoutRaw, refetch: refetchPayout } = useReadContract({
    address: ADDR,
    abi,
    functionName: "payout",
    args: [address ?? zeroAddress],
    query: { enabled: !!ADDR && !!address, refetchInterval: 5000 },
  });

  const refreshReads = useCallback(() => {
    void refetchMine();
    void refetchRoom();
    void refetchPayout();
  }, [refetchMine, refetchPayout, refetchRoom]);

  const { send, busy, phase, hash } = useTx(refreshReads);

  useEffect(() => {
    if (hash) setLastHash(hash);
  }, [hash]);

  const stake = (stakeRaw as bigint | undefined) ?? 0n;
  const payout = (payoutRaw as bigint | undefined) ?? 0n;
  const room = roomRaw as unknown as Room | undefined;
  const [shipper, inspector, declared, actual, wasInspected, winner, state, pot] =
    room ?? [zeroAddress, zeroAddress, 0, 0, false, 2, 0, 0n];
  const nextRoom = roomCountRaw !== undefined ? Number(roomCountRaw as bigint) : 0;
  const isShipper = !!address && shipper.toLowerCase() === address.toLowerCase();
  const actualType = state === 4 && wasInspected ? actual : lastApi?.cargo ? lastApi.cargo.type : undefined;
  const decoded = cargoLabel(myCargo?.value || (lastApi?.cargo ? BigInt(lastApi.cargo.value) : null));
  const botJoined = bot?.address && inspector.toLowerCase() === bot.address.toLowerCase();
  const canAiJoin = hasRoom && isShipper && state === 1 && inspector === zeroAddress;
  const canFile = hasRoom && isShipper && state === 1;
  const canAiDecide = hasRoom && state === 2 && botJoined;
  const canAiSettle = hasRoom && state === 3 && wasInspected;

  const loadBot = useCallback(async () => {
    const query = hasRoom ? `?roomId=${myRoom}` : "";
    const res = await fetch(`/api/exist/status${query}`, { cache: "no-store" });
    const data = (await res.json()) as ApiPayload;
    if (data.ok && data.bot) setBot(data.bot);
  }, [hasRoom, myRoom]);

  useEffect(() => {
    void loadBot();
    const timer = setInterval(() => void loadBot(), 7000);
    return () => clearInterval(timer);
  }, [loadBot]);

  async function callAi(path: string, label: string) {
    if (!hasRoom) return;
    setAiBusy(label);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId: String(myRoom) }),
      });
      const data = (await res.json()) as ApiPayload;
      setLastApi(data);
      if (!res.ok || !data.ok) throw new Error(data.error || "AI transaction failed");
      if (data.tx?.hash) setLastHash(data.tx.hash);
      toast.success(data.skipped ? "AI step already complete" : `AI ${data.action} confirmed`);
      refreshReads();
      await loadBot();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI transaction failed");
    } finally {
      setAiBusy(null);
    }
  }

  async function loadPrivateCargo() {
    if (!ADDR || !walletClient || !publicClient || !hasRoom) return;
    setDecrypting(true);
    try {
      const handle = (await publicClient.readContract({ address: ADDR, abi, functionName: "cargoHandle", args: [rid] })) as Hex;
      const [cargo] = await peek(walletClient, [handle]);
      setMyCargo(cargo);
      toast.success("Cargo decrypted with wallet signature");
    } catch {
      toast.error("Private decrypt failed. Wait for Inco, then retry.");
    } finally {
      setDecrypting(false);
    }
  }

  const statusLine = useMemo(() => {
    if (!isConnected) return "Connect a wallet. This wallet will be the shipper.";
    if (!hasRoom) return "Open a shipment. Your wallet signs the first on-chain transaction.";
    if (state === 1 && !botJoined) return "Send the AI Inspector on-chain. The bot wallet will join this room.";
    if (state === 1) return "Peek cargo, choose a public manifest, then file it with your wallet.";
    if (state === 2) return "Ask the AI Inspector to inspect or clear. The bot signs the decision transaction.";
    if (state === 3) return "The seal is broken. Let the AI settle with the public Inco reveal.";
    if (state === 4) return "Round closed. Claim winnings if your wallet has payout.";
    return "Live customs lane ready.";
  }, [botJoined, hasRoom, isConnected, state]);

  return (
    <main className="min-h-[calc(100vh-53px)] bg-black text-white">
      <section className="border-b-2 border-amber-300 bg-[radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.22),transparent_32%),linear-gradient(135deg,#030712_0%,#020617_58%,#111827_100%)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.42em] text-amber-200">Existence proof lane</p>
            <h1 className="mt-2 text-4xl uppercase tracking-wide sm:text-6xl">Contraband / AI Inspector</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/72">
              This route is the live version: your wallet signs shipper actions, while a server-side AI wallet signs the inspector actions on Base Sepolia.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a className="border border-white/25 px-3 py-2 text-xs uppercase tracking-widest text-white/70 hover:border-amber-300 hover:text-amber-200" href="/" target="_blank">
              original demo
            </a>
            <ConnectWallet />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="grid gap-5">
          <Panel className="border-amber-300/80 bg-black/78">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ScanLine className="text-amber-200" />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200">Live customs lane</p>
                  <p className="mt-1 text-sm text-white/70">{statusLine}</p>
                </div>
              </div>
              <a className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/55 hover:text-amber-200" href={txUrl(lastHash) ?? addrUrl(ADDR)} target="_blank" rel="noreferrer">
                {lastHash ? "last tx" : "contract"} <ExternalLink size={13} />
              </a>
            </div>
            <TxBar text={busy ? phase : aiBusy || (decrypting ? "waiting for wallet signature" : null)} />
          </Panel>

          <div className="grid gap-2 sm:grid-cols-4">
            {["Open", "AI joins", "Manifest", "AI verdict"].map((label, index) => {
              const done = index === 0 ? hasRoom : index === 1 ? Boolean(botJoined) : index === 2 ? state >= 2 : state === 4;
              const active = index === 0 ? !hasRoom : index === 1 ? state === 1 && !botJoined : index === 2 ? state === 1 && Boolean(botJoined) : state >= 2 && state < 4;
              return (
                <div key={label} className={`flex min-h-14 items-center gap-2 border px-3 py-2 ${stepClass(active, done)}`}>
                  <span className="grid h-6 w-8 place-items-center border border-current text-[10px]">{done ? "OK" : active ? "ON" : "--"}</span>
                  <span className="text-[11px] uppercase tracking-widest">{label}</span>
                </div>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-[0.98fr_1.02fr]">
            <Panel className="relative min-h-[520px] overflow-hidden border-cyan-200/60 bg-slate-950 p-0">
              <div className="scanner-grid absolute inset-0 opacity-85" />
              <motion.div
                className="scanner-sweep absolute left-0 top-0 h-full w-1/3"
                animate={{ x: ["-40%", state >= 3 ? "265%" : "180%"] }}
                transition={{ duration: state >= 3 ? 1.1 : 2.8, repeat: Infinity, ease: "linear" }}
              />
              <div className="relative z-10 flex min-h-[520px] flex-col justify-between p-5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-cyan-100">
                  <span>Encrypted scanner</span>
                  <span>{STATE[state] ?? "Idle"}</span>
                </div>

                <motion.div
                  className="mx-auto grid aspect-[5/3] w-full max-w-md place-items-center border-2 border-cyan-200 bg-black/72"
                  animate={{ scale: state >= 3 ? 1.03 : 0.98 }}
                  transition={{ type: "spring", stiffness: 120, damping: 18 }}
                >
                  <div className="relative h-[62%] w-[74%] border-2 border-amber-200 bg-amber-200/15">
                    <div className="absolute left-[18%] top-[18%] h-[38%] w-[25%] border-2 border-cyan-200 bg-cyan-200/20" />
                    <div className="absolute right-[18%] top-[28%] h-[36%] w-[28%] border-2 border-red-300 bg-red-300/15" />
                    <div className="absolute bottom-[12%] left-[38%] h-[20%] w-[25%] border-2 border-emerald-300 bg-emerald-300/15" />
                  </div>
                </motion.div>

                <div className="grid gap-3 border-2 border-white/20 bg-black/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">Cargo evidence</p>
                      <p className="mt-1 text-4xl uppercase tracking-wide text-amber-200">{decoded.code}</p>
                    </div>
                    <div className="border border-cyan-200/70 bg-cyan-200/10 px-3 py-2 text-right text-xs uppercase tracking-widest text-cyan-100">
                      {outcome(declared, actualType)}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="border border-white/15 bg-white/[0.05] p-3">
                      <p className="text-[10px] uppercase tracking-widest text-white/45">Private cargo</p>
                      <p className="mt-1 text-sm uppercase">{decoded.type}</p>
                    </div>
                    <div className="border border-white/15 bg-white/[0.05] p-3">
                      <p className="text-[10px] uppercase tracking-widest text-white/45">Manifest</p>
                      <p className="mt-1 text-sm uppercase">{state >= 2 ? CLAIMS[declared] : "Not filed"}</p>
                    </div>
                    <div className="border border-white/15 bg-white/[0.05] p-3">
                      <p className="text-[10px] uppercase tracking-widest text-white/45">Pot</p>
                      <p className="mt-1 text-sm uppercase">{formatEther(pot)} ETH</p>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            <div className="grid content-start gap-4">
              <Panel className="border-white/25 bg-white/[0.06]">
                <div className="mb-4 flex items-center gap-2 text-amber-200">
                  <PackageOpen size={18} />
                  <p className="text-sm uppercase tracking-widest">1. Human shipper</p>
                </div>
                <p className="mb-4 text-sm leading-6 text-white/72">Your connected wallet opens a real room and receives hidden cargo from Inco.</p>
                <Button
                  className="w-full"
                  disabled={!ADDR || !isConnected || busy || stake === 0n}
                  onClick={() => {
                    setMyCargo(null);
                    setLastApi(null);
                    send({ address: ADDR!, abi, functionName: "openManifest", args: [], value: stake });
                  }}
                >
                  wallet tx: open shipment {stake ? formatEther(stake) : ""}
                </Button>
                <p className="mt-3 text-xs uppercase tracking-widest text-white/45">Room {hasRoom ? myRoom : nextRoom}</p>
              </Panel>

              <Panel className="border-white/25 bg-white/[0.06]">
                <div className="mb-4 flex items-center gap-2 text-cyan-200">
                  <Bot size={18} />
                  <p className="text-sm uppercase tracking-widest">2. AI inspector</p>
                </div>
                <p className="mb-4 text-sm leading-6 text-white/72">The AI bot joins as the second player with its own server-side wallet.</p>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!canAiJoin || Boolean(aiBusy)}
                  onClick={() => callAi("/api/exist/join", "AI joining on-chain")}
                >
                  AI tx: join room
                </Button>
              </Panel>

              <Panel className="border-white/25 bg-white/[0.06]">
                <div className="mb-4 flex items-center gap-2 text-amber-200">
                  <ClipboardCheck size={18} />
                  <p className="text-sm uppercase tracking-widest">3. File manifest</p>
                </div>
                <div className="grid gap-3">
                  <div className="grid grid-cols-3 gap-2">
                    {CLAIMS.map((label, i) => (
                      <button
                        key={label}
                        onClick={() => setClaim(i)}
                        className={`min-h-14 border px-2 text-xs uppercase tracking-widest ${claim === i ? "border-amber-300 bg-amber-300 text-black" : "border-white/20 bg-black/35 text-white/70 hover:border-amber-300 hover:text-amber-100"}`}
                      >
                        {CLAIM_BUTTONS[i]}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" disabled={!canFile || decrypting} onClick={loadPrivateCargo}>
                      wallet signature: peek
                    </Button>
                    <Button disabled={!canFile || !botJoined || busy} onClick={() => send({ address: ADDR!, abi, functionName: "declareCargo", args: [rid, claim] })}>
                      wallet tx: file manifest
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel className="border-white/25 bg-white/[0.06]">
                <div className="mb-4 flex items-center gap-2 text-cyan-200">
                  <ShieldCheck size={18} />
                  <p className="text-sm uppercase tracking-widest">4. AI decision</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button variant="outline" disabled={!canAiDecide || Boolean(aiBusy)} onClick={() => callAi("/api/exist/decide", "AI deciding on-chain")}>
                    AI tx: inspect or pass
                  </Button>
                  <Button disabled={!canAiSettle || Boolean(aiBusy)} onClick={() => callAi("/api/exist/settle", "AI settling reveal")}>
                    AI tx: settle verdict
                  </Button>
                </div>
                {lastApi?.decision && (
                  <div className="mt-4 border border-cyan-200/40 bg-cyan-200/10 p-3 text-sm leading-6 text-cyan-50">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200">AI reason, {lastApi.decision.source}</p>
                    {lastApi.decision.reason}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </div>

        <aside className="grid content-start gap-5">
          <Panel className="border-cyan-200/60 bg-black/75">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-cyan-100">
                <Cpu size={18} />
                <p className="text-sm uppercase tracking-widest">AI wallet status</p>
              </div>
              <button onClick={() => void loadBot()} className="border border-cyan-200 px-2 py-1 text-[11px] uppercase tracking-widest text-cyan-100 hover:bg-cyan-200 hover:text-black">
                refresh
              </button>
            </div>
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-2">
                <span className="text-white/55">Bot address</span>
                <span className="font-mono text-cyan-100">{short(bot?.address)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-2">
                <span className="text-white/55">Balance</span>
                <span>{shortEth(bot?.balanceEth)} ETH</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-2">
                <span className="text-white/55">Stake</span>
                <span>{bot?.stakeEth ?? (stake ? formatEther(stake) : "0")} ETH</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/15 pb-2">
                <span className="text-white/55">Gemini</span>
                <span className={bot?.hasGemini ? "text-emerald-200" : "text-amber-200"}>{bot?.hasGemini ? "enabled" : "fallback AI"}</span>
              </div>
              <Button variant="outline" disabled={!bot || Number(bot.payoutEth) <= 0 || Boolean(aiBusy)} onClick={() => callAi("/api/exist/claim", "AI claiming payout")}>
                AI tx: claim bot payout
              </Button>
            </div>
          </Panel>

          <Panel className="border-white/20 bg-white/[0.06]">
            <div className="mb-4 flex items-center gap-2 text-amber-200">
              <Wallet size={18} />
              <p className="text-sm uppercase tracking-widest">Current room</p>
            </div>
            <div className="grid gap-2 text-xs uppercase tracking-widest text-white/70">
              <div className="flex justify-between border-b border-white/15 pb-2"><span>Room</span><span>{hasRoom ? myRoom : "none"}</span></div>
              <div className="flex justify-between border-b border-white/15 pb-2"><span>State</span><span>{STATE[state] ?? "Idle"}</span></div>
              <div className="flex justify-between border-b border-white/15 pb-2"><span>Shipper</span><span>{short(shipper)}</span></div>
              <div className="flex justify-between border-b border-white/15 pb-2"><span>Inspector</span><span>{short(inspector)}</span></div>
              <div className="flex justify-between"><span>Winner</span><span>{winner === 0 ? "shipper" : winner === 1 ? "inspector" : "unset"}</span></div>
            </div>
          </Panel>

          {state === 4 && (
            <Panel className={winner === 0 ? "border-emerald-300 bg-emerald-400/10" : "border-red-300 bg-red-400/10"}>
              <div className="flex items-start gap-3">
                <BadgeCheck className={winner === 0 ? "text-emerald-200" : "text-red-200"} />
                <div>
                  <p className="text-lg uppercase tracking-widest">{winner === 0 ? "Shipper wins" : "Inspector wins"}</p>
                  <p className="mt-2 text-sm leading-6 text-white/72">
                    Declared {CLAIMS[declared]}. {wasInspected ? `Actual cargo: ${CLAIMS[actual]}.` : "AI cleared the shipment without breaking the seal."}
                  </p>
                  {payout > 0n && (
                    <Button className="mt-4" disabled={!ADDR || busy} onClick={() => send({ address: ADDR!, abi, functionName: "claim", args: [] })}>
                      wallet tx: claim {formatEther(payout)} ETH
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </aside>
      </section>
    </main>
  );
}
