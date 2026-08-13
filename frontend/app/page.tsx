"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, ClipboardCheck, PackageOpen, ScanLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatEther, zeroAddress, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import contrabandAbi from "@/abi/ContrabandProtocol.json";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Button, Panel, TxBar } from "@/components/ui";
import { celebrate } from "@/lib/confetti";
import { ADDRESSES, addrUrl, txUrl, short } from "@/lib/games";
import { peek, readPublic, toSettleArgs, type Revealed } from "@/lib/deck";
import { useTx } from "@/hooks/useTx";

const ADDR = ADDRESSES.contraband as `0x${string}` | undefined;
const abi = contrabandAbi;
const CLAIMS = ["Clean cargo", "Contraband", "Artifact"] as const;
const CLAIM_BUTTONS = ["Clean", "Contraband", "Artifact"] as const;
const STATE = ["Open", "Dealt", "Claimed", "Inspecting", "Done"] as const;

type Room = [string, string, number, number, boolean, number, number, bigint];

function cargoType(value: bigint | number) {
  const v = Number(value);
  if (v <= 12) return 0;
  if (v <= 20) return 1;
  return 2;
}

function cargoLabel(value?: bigint | number | null) {
  if (!value) return { code: "SEALED", type: "Unknown cargo", detail: "Encrypted on Inco" };
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

function verdict(claim: number, actual?: number) {
  if (actual === undefined) return "Not scanned";
  if (claim === actual) return "Manifest verified";
  return "False manifest";
}

function nextAction(role: string, state: number, hasRoom: boolean) {
  if (!hasRoom) return "Open a shipment or join a room as inspector.";
  if (state === 1 && role === "shipper") return "Peek at your private cargo, choose a manifest, then file it.";
  if (state === 1) return "Waiting for the shipper to file the manifest.";
  if (state === 2 && role === "inspector") return "Clear the shipment or run the scanner.";
  if (state === 2) return "Inspector is deciding whether to scan the seal.";
  if (state === 3) return "Scanner opened the seal. Settle with the attested cargo value.";
  if (state === 4) return "Round closed. Claim winnings if you have a payout.";
  return "Shipment is being prepared.";
}

function statusClass(state: number, actualType?: number, declared?: number) {
  if (state === 4 && actualType !== undefined && declared !== undefined) {
    return actualType === declared ? "border-emerald-300 bg-emerald-300/10 text-emerald-100" : "border-red-300 bg-red-400/10 text-red-100";
  }
  if (state === 3) return "border-amber-300 bg-amber-300/10 text-amber-100";
  if (state === 2) return "border-sky-300 bg-sky-300/10 text-sky-100";
  return "border-white/20 bg-white/8 text-white";
}

function laneStep(active: boolean, done: boolean, label: string) {
  return (
    <div className={`flex items-center gap-2 border px-3 py-2 ${active ? "border-amber-300 bg-amber-300 text-black" : done ? "border-emerald-300 bg-emerald-300/10 text-emerald-100" : "border-white/15 bg-black/30 text-white/55"}`}>
      <span className="grid h-5 w-5 place-items-center border border-current text-[10px]">{done ? "OK" : active ? "ON" : "--"}</span>
      <span className="truncate text-[11px] uppercase tracking-widest">{label}</span>
    </div>
  );
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [joinId, setJoinId] = useState("0");
  const [claim, setClaim] = useState(0);
  const [myCargo, setMyCargo] = useState<Revealed | null>(null);
  const [publicCargo, setPublicCargo] = useState<Revealed | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [demoCargo, setDemoCargo] = useState(17);
  const [demoClaim, setDemoClaim] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);

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
    query: { enabled: !!ADDR && hasRoom, refetchInterval: 5000 },
  });
  const { data: payoutRaw, refetch: refetchPayout } = useReadContract({
    address: ADDR,
    abi,
    functionName: "payout",
    args: [address ?? zeroAddress],
    query: { enabled: !!ADDR && !!address, refetchInterval: 5000 },
  });
  const { send, busy, phase, hash } = useTx(() => {
    void refetchMine();
    void refetchRoom();
    void refetchPayout();
  });

  const stake = (stakeRaw as bigint | undefined) ?? 0n;
  const payout = (payoutRaw as bigint | undefined) ?? 0n;
  const room = roomRaw as unknown as Room | undefined;
  const [shipper, inspector, declared, actual, wasInspected, winner, state, pot] =
    room ?? [zeroAddress, zeroAddress, 0, 0, false, 2, 0, 0n];
  const role = useMemo(() => {
    if (!address || !room) return "observer";
    if (shipper.toLowerCase() === address.toLowerCase()) return "shipper";
    if (inspector.toLowerCase() === address.toLowerCase()) return "inspector";
    return "observer";
  }, [address, room, shipper, inspector]);
  const liveCargo = publicCargo ?? myCargo;
  const liveDecoded = cargoLabel(liveCargo?.value);
  const actualType = publicCargo ? cargoType(publicCargo.value) : wasInspected && state === 4 ? actual : undefined;
  const nextRoom = roomCountRaw !== undefined ? Number(roomCountRaw as bigint) : 0;
  const canSettle = state === 3 && wasInspected;
  const demoActual = cargoType(demoCargo);
  const demoDecoded = cargoLabel(demoCargo);
  const activeMessage = nextAction(role, state, hasRoom);

  async function loadPrivateCargo() {
    if (!ADDR || !walletClient || !publicClient || !hasRoom) return;
    setDecrypting(true);
    try {
      const handle = (await publicClient.readContract({ address: ADDR, abi, functionName: "cargoHandle", args: [rid] })) as Hex;
      const [cargo] = await peek(walletClient, [handle]);
      setMyCargo(cargo);
      toast.success("Private cargo decrypted");
    } catch {
      toast.error("Private decrypt failed. Wait for the covalidator, then retry.");
    } finally {
      setDecrypting(false);
    }
  }

  async function settleInspection() {
    if (!ADDR || !publicClient || !hasRoom) return;
    try {
      const handle = (await publicClient.readContract({ address: ADDR, abi, functionName: "cargoHandle", args: [rid] })) as Hex;
      let cargo: Revealed | null = null;
      for (let i = 0; i < 8 && !cargo; i++) {
        try {
          [cargo] = await readPublic([handle]);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
      if (!cargo) throw new Error("not revealed");
      setPublicCargo(cargo);
      const { values, sigs } = toSettleArgs([cargo]);
      send({ address: ADDR, abi, functionName: "settle", args: [rid, values[0], sigs[0]] });
      if (cargoType(cargo.value) !== declared && role === "inspector") void celebrate();
    } catch {
      toast.error("Public reveal is not ready yet. Retry in a few seconds.");
    }
  }

  function resetDemo() {
    setDemoCargo(1 + Math.floor(Math.random() * 24));
    setDemoClaim(Math.floor(Math.random() * 3));
    setDemoOpen(false);
  }

  return (
    <main className="mx-auto grid min-h-[calc(100vh-53px)] max-w-7xl gap-5 px-3 py-4 text-white sm:px-5 lg:grid-cols-[1.08fr_0.92fr]">
      <section className="overflow-hidden border-2 border-white/20 bg-black/72 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="border-b-2 border-white/20 bg-amber-300 px-4 py-3 text-black">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.34em]">Customs Inspection Lane</p>
              <h1 className="mt-1 text-3xl uppercase tracking-wide sm:text-5xl">Contraband Protocol</h1>
            </div>
            <ConnectWallet />
          </div>
        </div>

        <div className="grid border-b border-white/20 bg-white/[0.06] text-xs uppercase tracking-widest sm:grid-cols-4">
          <div className="border-b border-white/15 px-4 py-3 sm:border-b-0 sm:border-r">Room <span className="ml-2 text-amber-200">{hasRoom ? myRoom : nextRoom}</span></div>
          <div className="border-b border-white/15 px-4 py-3 sm:border-b-0 sm:border-r">Role <span className="ml-2 text-amber-200">{role}</span></div>
          <div className="border-b border-white/15 px-4 py-3 sm:border-b-0 sm:border-r">State <span className="ml-2 text-amber-200">{STATE[state] ?? "Idle"}</span></div>
          <div className="px-4 py-3">Pot <span className="ml-2 text-amber-200">{formatEther(pot)} ETH</span></div>
        </div>

        <div className="p-4">
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            {laneStep(state >= 1 && state < 2, state > 1, "Deal")}
            {laneStep(state === 2, state > 2, "Manifest")}
            {laneStep(state === 3, state > 3, "Scan")}
            {laneStep(state === 4, false, "Verdict")}
          </div>

          <div className="grid gap-5 lg:grid-cols-[0.94fr_1.06fr]">
          <div className="grid gap-4">
            <Panel className="relative min-h-[470px] overflow-hidden border-white/25 bg-slate-950 p-0">
              <div className="scanner-grid absolute inset-0 opacity-90" />
              <motion.div
                className="scanner-sweep absolute left-0 top-0 h-full w-1/3"
                animate={{ x: ["-40%", "260%"] }}
                transition={{ duration: state === 3 || demoOpen ? 1.25 : 3.2, repeat: Infinity, ease: "linear" }}
              />
              <div className="relative z-10 flex h-full min-h-[470px] flex-col justify-between p-5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-cyan-100">
                  <span className="flex items-center gap-2"><ScanLine size={14} /> Baggage scanner</span>
                  <span>{publicCargo ? "Seal broken" : myCargo ? "Private view" : "Encrypted"}</span>
                </div>

                <motion.div
                  animate={{ scale: publicCargo ? 1.02 : myCargo ? 1 : 0.96, opacity: publicCargo || myCargo ? 1 : 0.92 }}
                  transition={{ type: "spring", stiffness: 120, damping: 18 }}
                  className="mx-auto grid aspect-[5/3] w-full max-w-md place-items-center border-2 border-cyan-200 bg-black/70 shadow-[0_0_40px_rgba(103,232,249,0.18)]"
                >
                  <div className="relative h-[62%] w-[74%] border-2 border-amber-200 bg-amber-200/15">
                    <div className="absolute left-[18%] top-[18%] h-[38%] w-[25%] border-2 border-cyan-200 bg-cyan-200/20" />
                    <div className="absolute right-[18%] top-[28%] h-[36%] w-[28%] border-2 border-red-300 bg-red-300/15" />
                    <div className="absolute bottom-[12%] left-[38%] h-[20%] w-[25%] border-2 border-emerald-300 bg-emerald-300/15" />
                  </div>
                </motion.div>

                <div className="grid gap-3 border-2 border-white/20 bg-black/75 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.32em] text-white/55">Scan result</p>
                      <p className="mt-1 text-4xl uppercase tracking-wide text-amber-200">{liveDecoded.code}</p>
                    </div>
                    <div className={`border px-3 py-2 text-right text-xs uppercase tracking-widest ${statusClass(state, actualType, declared)}`}>
                      {verdict(declared, actualType)}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="border border-white/15 bg-white/[0.05] p-3">
                      <p className="text-[10px] uppercase tracking-widest text-white/45">Private cargo</p>
                      <p className="mt-1 text-sm uppercase text-white">{liveDecoded.type}</p>
                    </div>
                    <div className="border border-white/15 bg-white/[0.05] p-3">
                      <p className="text-[10px] uppercase tracking-widest text-white/45">Manifest</p>
                      <p className="mt-1 text-sm uppercase text-white">{state >= 2 ? CLAIMS[declared] : "Not filed"}</p>
                    </div>
                    <div className="border border-white/15 bg-white/[0.05] p-3">
                      <p className="text-[10px] uppercase tracking-widest text-white/45">Item</p>
                      <p className="mt-1 truncate text-sm uppercase text-white">{liveDecoded.detail}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid content-start gap-4">
            <Panel className="border-amber-300/70 bg-amber-300/10">
              <div className="flex items-start gap-3">
                <ClipboardCheck className="mt-0.5 text-amber-200" size={20} />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200">Next action</p>
                  <p className="mt-2 text-sm leading-6 text-white">{activeMessage}</p>
                </div>
              </div>
              <TxBar text={busy ? phase : decrypting ? "decrypting cargo" : null} />
            </Panel>

            {!ADDR && (
              <div className="border-2 border-red-300 bg-red-500/10 p-4 text-sm text-red-100">
                Set NEXT_PUBLIC_CONTRABAND_ADDRESS to enable live play.
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Panel className="border-white/25 bg-white/[0.06]">
                <div className="mb-4 flex items-center gap-2 text-amber-200">
                  <PackageOpen size={18} />
                  <p className="text-sm uppercase tracking-widest">Start as shipper</p>
                </div>
                <p className="mb-4 text-sm leading-6 text-white/75">Create a room and receive hidden cargo.</p>
                <Button
                  className="w-full"
                  disabled={!ADDR || !isConnected || busy || stake === 0n}
                  onClick={() => {
                    setMyCargo(null);
                    setPublicCargo(null);
                    send({ address: ADDR!, abi, functionName: "openManifest", args: [], value: stake });
                  }}
                >
                  Open shipment {stake ? formatEther(stake) : ""}
                </Button>
              </Panel>

              <Panel className="border-white/25 bg-white/[0.06]">
                <div className="mb-4 flex items-center gap-2 text-cyan-200">
                  <ShieldCheck size={18} />
                  <p className="text-sm uppercase tracking-widest">Join as inspector</p>
                </div>
                <p className="mb-4 text-sm leading-6 text-white/75">Enter a room ID and decide whether to scan.</p>
                <div className="flex gap-2">
                  <input
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value.replace(/[^0-9]/g, ""))}
                    className="min-w-0 flex-1 border-2 border-white/25 bg-black px-3 text-sm text-white outline-none focus:border-cyan-200"
                    aria-label="Room id"
                  />
                  <Button
                    variant="outline"
                    disabled={!ADDR || !isConnected || busy || stake === 0n}
                    onClick={() => send({ address: ADDR!, abi, functionName: "joinAsInspector", args: [BigInt(joinId || "0")], value: stake })}
                  >
                    Join
                  </Button>
                </div>
              </Panel>
            </div>

            <Panel className="border-white/25 bg-white/[0.06]">
              <div className="mb-4 flex items-center gap-2 text-amber-200">
                <BadgeCheck size={18} />
                <p className="text-sm uppercase tracking-widest">Shipper manifest</p>
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
                  <Button variant="outline" disabled={role !== "shipper" || state < 1 || decrypting} onClick={loadPrivateCargo}>
                    Peek cargo
                  </Button>
                  <Button
                    disabled={!ADDR || role !== "shipper" || state !== 1 || busy}
                    onClick={() => send({ address: ADDR!, abi, functionName: "declareCargo", args: [rid, claim] })}
                  >
                    File manifest
                  </Button>
                </div>
              </div>
            </Panel>

            <Panel className="border-white/25 bg-white/[0.06]">
              <div className="mb-4 flex items-center gap-2 text-cyan-200">
                <ScanLine size={18} />
                <p className="text-sm uppercase tracking-widest">Inspector decision</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Button variant="outline" disabled={!ADDR || role !== "inspector" || state !== 2 || busy} onClick={() => send({ address: ADDR!, abi, functionName: "pass", args: [rid] })}>
                  Clear shipment
                </Button>
                <Button variant="outline" disabled={!ADDR || role !== "inspector" || state !== 2 || busy} onClick={() => send({ address: ADDR!, abi, functionName: "inspect", args: [rid] })}>
                  Run scanner
                </Button>
                <Button disabled={!ADDR || !canSettle || busy} onClick={settleInspection}>
                  Settle verdict
                </Button>
              </div>
            </Panel>

            {state === 4 && (
              <div className={`border-2 p-4 ${winner === 0 ? "border-emerald-300 bg-emerald-400/10" : "border-red-300 bg-red-400/10"}`}>
                <div className="flex items-center gap-3">
                  {winner === 0 ? <BadgeCheck className="text-emerald-200" /> : <AlertTriangle className="text-red-200" />}
                  <div>
                    <p className="text-lg uppercase tracking-widest text-white">{winner === 0 ? "Shipper wins" : winner === 1 ? "Inspector wins" : "Round closed"}</p>
                    <p className="mt-1 text-sm text-white/70">
                      Declared {CLAIMS[declared]}. {wasInspected ? `Actual cargo: ${CLAIMS[actual]}.` : "The seal stayed closed."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-widest text-white/60">
              {payout > 0n && (
                <Button disabled={!ADDR || busy} onClick={() => send({ address: ADDR!, abi, functionName: "claim", args: [] })}>
                  Claim {formatEther(payout)} ETH
                </Button>
              )}
              <a className="hover:text-amber-200" href={txUrl(hash) ?? addrUrl(ADDR)} target="_blank" rel="noreferrer">
                Contract {ADDR ? short(ADDR) : "not set"}
              </a>
            </div>
          </div>
        </div>
        </div>
      </section>

      <aside className="grid gap-5">
        <Panel className="border-cyan-200/60 bg-black/75">
          <div className="mb-4 flex items-center justify-between gap-3 text-[11px] uppercase tracking-widest text-cyan-100">
            <span className="flex items-center gap-2"><ScanLine size={14} /> Practice scanner</span>
            <button onClick={resetDemo} className="border border-cyan-200 px-2 py-1 text-cyan-100 hover:bg-cyan-200 hover:text-black">New bag</button>
          </div>
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-2">
              {CLAIMS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setDemoClaim(i)}
                  className={`min-h-12 border px-2 text-[11px] uppercase ${demoClaim === i ? "border-amber-300 bg-amber-300 text-black" : "border-white/20 bg-white/[0.04] text-white/65"}`}
                >
                  {CLAIM_BUTTONS[i]}
                </button>
              ))}
            </div>

            <motion.div layout className="relative overflow-hidden border-2 border-cyan-200 bg-slate-950 p-5 text-center">
              <div className="scanner-grid absolute inset-0 opacity-70" />
              <motion.div
                className="scanner-sweep absolute left-0 top-0 h-full w-1/2"
                animate={{ x: demoOpen ? ["-60%", "210%"] : "-60%" }}
                transition={{ duration: 1.2, repeat: demoOpen ? Infinity : 0, ease: "linear" }}
              />
              <div className="relative z-10">
                <p className="text-[11px] uppercase tracking-[0.35em] text-white/60">{demoOpen ? "Scanner open" : "Seal intact"}</p>
                <p className="mt-5 text-4xl uppercase text-amber-200">{demoOpen ? demoDecoded.code : "HANDLE-0X"}</p>
                <p className="mt-3 text-sm uppercase tracking-widest text-white">{demoOpen ? demoDecoded.type : "Private cargo"}</p>
                <p className="mt-2 text-xs text-white/60">{demoOpen ? demoDecoded.detail : "The inspector cannot read the cargo yet."}</p>
              </div>
            </motion.div>

            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setDemoOpen(false)}>Clear</Button>
              <Button onClick={() => setDemoOpen(true)}>Scan</Button>
            </div>
            <div className={`border px-3 py-3 text-sm ${statusClass(demoOpen ? 4 : 2, demoOpen ? demoActual : undefined, demoClaim)}`}>
              Result: {demoOpen ? verdict(demoClaim, demoActual) : "Shipper keeps the seal closed"}
            </div>
          </div>
        </Panel>

        <Panel className="border-white/20 bg-white/[0.06]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.35em] text-amber-200">Cargo table</p>
          <div className="grid gap-2 text-xs uppercase tracking-widest text-white/70">
            <div className="flex justify-between border-b border-white/15 pb-2"><span>1-12</span><span>Clean cargo</span></div>
            <div className="flex justify-between border-b border-white/15 pb-2"><span>13-20</span><span>Contraband</span></div>
            <div className="flex justify-between"><span>21-24</span><span>Artifact</span></div>
          </div>
        </Panel>
      </aside>
    </main>
  );
}
