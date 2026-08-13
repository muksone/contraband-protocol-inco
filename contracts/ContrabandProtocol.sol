// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {euint256} from "@inco/lightning/src/Lib.sol";
import {ConfidentialDeck} from "./kit/ConfidentialDeck.sol";

/// @title Contraband Protocol
/// @notice A two-player bluffing game: a shipper privately receives cargo,
/// declares it, and an inspector chooses to pass or reveal and settle.
contract ContrabandProtocol is ConfidentialDeck {
    enum Claim { Clean, Contraband, Artifact }
    enum State { Open, Dealt, Claimed, Inspecting, Done }

    struct Room {
        address shipper;
        address inspector;
        euint256 cargo;
        Claim claim;
        uint8 actual;
        bool wasInspected;
        uint256 pot;
        uint8 winner; // 0 shipper, 1 inspector, 2 unset
        State state;
    }

    uint16 public constant CARGO_DECK_SIZE = 24;
    uint256 public immutable stake;
    Room[] private rooms;
    mapping(address => uint256) public payout;

    event ManifestOpened(uint256 indexed roomId, address indexed shipper);
    event InspectorJoined(uint256 indexed roomId, address indexed inspector);
    event CargoDeclared(uint256 indexed roomId, uint8 claim);
    event CargoPassed(uint256 indexed roomId, uint256 amount);
    event CargoInspected(uint256 indexed roomId);
    event CargoSettled(uint256 indexed roomId, uint8 actual, uint8 winner, uint256 amount);

    constructor(uint256 _stake) {
        require(_stake > 0, "stake=0");
        stake = _stake;
    }

    function openManifest() external payable returns (uint256 roomId) {
        require(msg.value == stake, "wrong stake");

        rooms.push();
        roomId = rooms.length - 1;
        Room storage r = rooms[roomId];
        r.shipper = msg.sender;
        r.pot = msg.value;
        r.winner = 2;
        r.state = State.Dealt;

        _newShuffledDeck(CARGO_DECK_SIZE);
        uint256 fee = deckFee(CARGO_DECK_SIZE);
        r.pot = r.pot > fee ? r.pot - fee : 0;
        r.cargo = _dealTo(msg.sender);

        emit ManifestOpened(roomId, msg.sender);
    }

    function joinAsInspector(uint256 roomId) external payable {
        Room storage r = rooms[roomId];
        require(r.state == State.Dealt, "not joinable");
        require(r.shipper != msg.sender, "shipper");
        require(r.inspector == address(0), "has inspector");
        require(msg.value == stake, "wrong stake");

        r.inspector = msg.sender;
        r.pot += msg.value;
        emit InspectorJoined(roomId, msg.sender);
    }

    function declareCargo(uint256 roomId, Claim declaredClaim) external {
        Room storage r = rooms[roomId];
        require(msg.sender == r.shipper, "not shipper");
        require(r.inspector != address(0), "no inspector");
        require(r.state == State.Dealt, "not dealt");

        r.claim = declaredClaim;
        r.state = State.Claimed;
        emit CargoDeclared(roomId, uint8(declaredClaim));
    }

    function pass(uint256 roomId) external {
        Room storage r = rooms[roomId];
        require(msg.sender == r.inspector, "not inspector");
        require(r.state == State.Claimed, "not claimed");

        uint256 amount = r.pot;
        r.pot = 0;
        r.winner = 0;
        r.state = State.Done;
        payout[r.shipper] += amount;
        emit CargoPassed(roomId, amount);
    }

    function inspect(uint256 roomId) external {
        Room storage r = rooms[roomId];
        require(msg.sender == r.inspector, "not inspector");
        require(r.state == State.Claimed, "not claimed");

        _revealCard(r.cargo);
        r.wasInspected = true;
        r.state = State.Inspecting;
        emit CargoInspected(roomId);
    }

    function settle(uint256 roomId, uint256 value, bytes[] calldata sigs) external {
        Room storage r = rooms[roomId];
        require(r.state == State.Inspecting, "inspect first");

        uint8 actual = cargoType(_verifyValue(r.cargo, value, sigs));
        bool truthful = actual == uint8(r.claim);
        uint256 amount = r.pot;
        r.pot = 0;
        r.actual = actual;
        r.winner = truthful ? 0 : 1;
        r.state = State.Done;

        payout[truthful ? r.shipper : r.inspector] += amount;
        emit CargoSettled(roomId, actual, r.winner, amount);
    }

    function claim() external {
        uint256 amount = payout[msg.sender];
        require(amount > 0, "nothing");
        payout[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
    }

    function cargoType(uint256 value) public pure returns (uint8) {
        require(value >= 1 && value <= CARGO_DECK_SIZE, "cargo out of range");
        if (value <= 12) return uint8(Claim.Clean);
        if (value <= 20) return uint8(Claim.Contraband);
        return uint8(Claim.Artifact);
    }

    function roomCount() external view returns (uint256) {
        return rooms.length;
    }

    function roomOf(uint256 id)
        external
        view
        returns (
            address shipper,
            address inspector,
            uint8 claim_,
            uint8 actual,
            bool wasInspected,
            uint8 winner,
            uint8 state,
            uint256 pot
        )
    {
        Room storage r = rooms[id];
        return (
            r.shipper,
            r.inspector,
            uint8(r.claim),
            r.actual,
            r.wasInspected,
            r.winner,
            uint8(r.state),
            r.pot
        );
    }

    function roomOfPlayer(address who) external view returns (int256) {
        for (uint256 i = rooms.length; i > 0; i--) {
            Room storage r = rooms[i - 1];
            if (r.shipper == who || r.inspector == who) return int256(i - 1);
        }
        return -1;
    }

    function cargoHandle(uint256 id) external view returns (bytes32) {
        return euint256.unwrap(rooms[id].cargo);
    }
}
