"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
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
const STATE = ["Open", "Dealt", "Claimed", "Inspecting", "Done"] as const;

type Room = [string, string, number, number, boolean, number, number, bigint];

function cargoType(value: bigint | number) {
  const v = Number(value);
  if (v <= 12) return 0;
  if (v <= 20) return 1;
  return 2;
}

function cargoLabel(value?: bigint | number | null) {
  if (!value) return { code: "--", type: "Sealed", detail: "encrypted handle only" };
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

function cargoRisk(claim: number, actual?: number) {
  if (actual === undefined) return "unknown";
  if (claim === actual) return "manifest verified";
  return "false manifest";
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
    <main className="mx-auto grid min-h-[calc(100vh-53px)] max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="flex min-h-[620px] flex-col justify-between border-2 border-border bg-background/65 p-5 backdrop-blur-sm">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mb-8 flex items-start justify-between gap-4"
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-muted-foreground">Inco Summer Game Jam</p>
              <h1 className="mt-2 text-3xl uppercase tracking-wide text-primary sm:text-5xl">Contraband Protocol</h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                A shipper sees a private cargo card, files a public manifest, and the inspector decides whether the seal is worth breaking.
              </p>
            </div>
            <ConnectWallet />
          </motion.div>

          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <Panel className="flex min-h-[360px] flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
                  <span>sealed container</span>
                  <span>{hasRoom ? `room ${myRoom}` : `next ${nextRoom}`}</span>
                </div>
                <motion.div
                  animate={{ rotateX: publicCargo ? 0 : myCargo ? 3 : 9, y: publicCargo ? 0 : -4 }}
                  transition={{ type: "spring", stiffness: 120, damping: 18 }}
                  className="grid aspect-[4/5] place-items-center border-2 border-primary bg-primary/10 p-6"
                >
                  <div className="text-center">
                    <p className="text-[11px] uppercase tracking-[0.4em] text-muted-foreground">
                      {publicCargo ? "revealed" : myCargo ? "private view" : "encrypted"}
                    </p>
                    <p className="mt-5 text-4xl uppercase tracking-wide text-primary">{liveDecoded.code}</p>
                    <p className="mt-4 text-sm uppercase tracking-widest text-foreground">{liveDecoded.type}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{liveDecoded.detail}</p>
                  </div>
                </motion.div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] uppercase tracking-widest">
                <div className="border border-border p-2 text-muted-foreground">Clean 12</div>
                <div className="border border-border p-2 text-muted-foreground">Hot 8</div>
                <div className="border border-border p-2 text-muted-foreground">Relic 4</div>
              </div>
            </Panel>

            <Panel className="flex flex-col gap-5">
              <div className="grid gap-2 text-xs uppercase tracking-widest text-muted-foreground sm:grid-cols-4">
                <div>role <span className="block text-primary">{role}</span></div>
                <div>state <span className="block text-primary">{STATE[state] ?? "Idle"}</span></div>
                <div>pot <span className="block text-primary">{formatEther(pot)} ETH</span></div>
                <div>risk <span className="block text-primary">{cargoRisk(declared, actualType)}</span></div>
              </div>

              <TxBar text={busy ? phase : decrypting ? "decrypting cargo" : null} />

              {!ADDR && (
                <div className="border border-destructive/60 p-3 text-xs text-destructive">
                  Set NEXT_PUBLIC_CONTRABAND_ADDRESS after deployment to enable live play.
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  disabled={!ADDR || !isConnected || busy || stake === 0n}
                  onClick={() => {
                    setMyCargo(null);
                    setPublicCargo(null);
                    send({ address: ADDR!, abi, functionName: "openManifest", args: [], value: stake });
                  }}
                >
                  Open manifest {stake ? formatEther(stake) : ""}
                </Button>
                <div className="flex gap-2">
                  <input
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value.replace(/[^0-9]/g, ""))}
                    className="min-w-0 flex-1 border-2 border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                    aria-label="Room id"
                  />
                  <Button
                    variant="outline"
                    disabled={!ADDR || !isConnected || busy || stake === 0n}
                    onClick={() => send({ address: ADDR!, abi, functionName: "joinAsInspector", args: [BigInt(joinId || "0")], value: stake })}
                  >
                    Inspect
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-[1fr_auto]">
                <div className="grid grid-cols-3 gap-2">
                  {CLAIMS.map((label, i) => (
                    <button
                      key={label}
                      onClick={() => setClaim(i)}
                      className={`border px-2 py-3 text-xs uppercase tracking-widest ${claim === i ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button
                  disabled={!ADDR || role !== "shipper" || state !== 1 || busy}
                  onClick={() => send({ address: ADDR!, abi, functionName: "declareCargo", args: [rid, claim] })}
                >
                  Declare
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <Button variant="outline" disabled={role !== "shipper" || state < 1 || decrypting} onClick={loadPrivateCargo}>
                  Peek
                </Button>
                <Button variant="outline" disabled={!ADDR || role !== "inspector" || state !== 2 || busy} onClick={() => send({ address: ADDR!, abi, functionName: "pass", args: [rid] })}>
                  Pass
                </Button>
                <Button variant="outline" disabled={!ADDR || role !== "inspector" || state !== 2 || busy} onClick={() => send({ address: ADDR!, abi, functionName: "inspect", args: [rid] })}>
                  Reveal
                </Button>
                <Button disabled={!ADDR || !canSettle || busy} onClick={settleInspection}>
                  Settle
                </Button>
              </div>

              {state === 4 && (
                <div className="border-2 border-primary bg-primary/5 p-4 text-sm">
                  <p className="uppercase tracking-widest text-primary">
                    {winner === 0 ? "Shipper wins" : winner === 1 ? "Inspector wins" : "Closed"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Declared {CLAIMS[declared]}. {wasInspected ? `Actual cargo: ${CLAIMS[actual]}.` : "The seal stayed closed."}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-widest text-muted-foreground">
                {payout > 0n && (
                  <Button disabled={!ADDR || busy} onClick={() => send({ address: ADDR!, abi, functionName: "claim", args: [] })}>
                    Claim {formatEther(payout)} ETH
                  </Button>
                )}
                <a className="hover:text-primary" href={txUrl(hash) ?? addrUrl(ADDR)} target="_blank" rel="noreferrer">
                  {ADDR ? short(ADDR) : "no contract"}
                </a>
              </div>
            </Panel>
          </div>
        </div>
      </section>

      <aside className="grid gap-6">
        <Panel className="overflow-hidden">
          <div className="mb-4 flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>demo scanner</span>
            <button onClick={resetDemo} className="hover:text-primary">new cargo</button>
          </div>
          <div className="grid gap-4">
            <div className="border-2 border-border bg-background/70 p-5">
              <p className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">shipper claim</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {CLAIMS.map((label, i) => (
                  <button
                    key={label}
                    onClick={() => setDemoClaim(i)}
                    className={`border px-2 py-2 text-[11px] uppercase ${demoClaim === i ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <motion.div
              layout
              className="border-2 border-primary bg-primary/10 p-6 text-center"
            >
              <p className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">{demoOpen ? "scanner open" : "seal intact"}</p>
              <p className="mt-5 text-3xl uppercase text-primary">{demoOpen ? cargoLabel(demoCargo).code : "HANDLE-0X"}</p>
              <p className="mt-3 text-sm uppercase tracking-widest text-foreground">{demoOpen ? cargoLabel(demoCargo).type : "private cargo"}</p>
              <p className="mt-2 text-xs text-muted-foreground">{demoOpen ? cargoLabel(demoCargo).detail : "only the shipper sees the plaintext"}</p>
            </motion.div>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setDemoOpen(false)}>Pass</Button>
              <Button onClick={() => setDemoOpen(true)}>Inspect</Button>
            </div>
            <div className="border-t border-border pt-4 text-xs text-muted-foreground">
              Result: <span className="text-primary">{demoOpen ? cargoRisk(demoClaim, cargoType(demoCargo)) : "shipper keeps the pot"}</span>
            </div>
          </div>
        </Panel>

        <Panel className="grid gap-4 text-sm text-muted-foreground">
          <p className="text-[11px] uppercase tracking-[0.35em] text-primary">submission angle</p>
          <p>The entire game turns on one hidden Inco value: a private cargo card that becomes public only if the inspector pays the social cost of opening the seal.</p>
          <div className="grid gap-2 text-xs uppercase tracking-widest">
            <div className="flex justify-between border-b border-border pb-2"><span>Shuffle</span><span>24 cargos</span></div>
            <div className="flex justify-between border-b border-border pb-2"><span>Deal</span><span>shipper only</span></div>
            <div className="flex justify-between border-b border-border pb-2"><span>Reveal</span><span>inspector choice</span></div>
            <div className="flex justify-between"><span>Settle</span><span>attested value</span></div>
          </div>
        </Panel>
      </aside>
    </main>
  );
}
