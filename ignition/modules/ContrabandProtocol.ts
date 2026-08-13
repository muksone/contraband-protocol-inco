import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "viem";

export default buildModule("ContrabandProtocol", (m) => {
  const stake = m.getParameter("stake", parseEther("0.003"));
  const game = m.contract("ContrabandProtocol", [stake]);
  return { game };
});
