// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {euint256} from "@inco/lightning/src/Lib.sol";
import {ConfidentialDeck} from "../kit/ConfidentialDeck.sol";
import {CardLib} from "../CardLib.sol";

/// @title War - the smallest game on ConfidentialDeck.
/// @notice One private card each; higher rank wins. Read this first.
contract War is ConfidentialDeck {
    using CardLib for uint8;

    uint256 public immutable bet;
    address[2] public players;
    euint256[2] private cards; // one private card per seat
    uint8 public seated;
    uint256 public winnings; // pull-payment credit
    mapping(address => uint256) public payout;

    enum State { Open, Dealt, Revealing, Done }
    State public state;

    event Joined(address indexed player, uint8 seat);
    event Dealt();
    event Showdown();
    event Result(uint8 winnerSeat, uint256 amount); // winnerSeat 2 == split

    constructor(uint256 _bet) {
        require(_bet > 0, "bet=0");
        bet = _bet;
    }

    /// @notice Join with exactly `bet`; 2nd player triggers deal.
    function join() external payable {
        require(state == State.Open, "not open");
        require(msg.value == bet, "wrong bet");
        require(msg.sender != players[0], "already seated");
        players[seated] = msg.sender;
        emit Joined(msg.sender, seated);
        seated += 1;
        if (seated == 2) _deal();
    }

    function _deal() private {
        _newShuffledDeck(52); // KIT: shuffle (fee from the two bets)
        cards[0] = _dealTo(players[0]); // KIT: private deal to seat 0
        cards[1] = _dealTo(players[1]); // KIT: private deal to seat 1
        state = State.Dealt;
        emit Dealt();
    }

    /// @notice Open both cards to everyone. Un-griefable.
    function showdown() external {
        require(state == State.Dealt, "not dealt");
        _revealCard(cards[0]); // KIT: open to everyone
        _revealCard(cards[1]); // KIT: open to everyone
        state = State.Revealing;
        emit Showdown();
    }

    /// @notice Post attested values and pay the winner.
    function settle(uint256[2] calldata values, bytes[][2] calldata sigs) external {
        require(state == State.Revealing, "call showdown first");
        uint8 r0 = CardLib.rankOf(CardLib.toId(_verifyValue(cards[0], values[0], sigs[0]))); // KIT: verify
        uint8 r1 = CardLib.rankOf(CardLib.toId(_verifyValue(cards[1], values[1], sigs[1]))); // KIT: verify

        uint256 pot = bet * 2;
        if (r0 > r1) {
            payout[players[0]] = pot;
            emit Result(0, pot);
        } else if (r1 > r0) {
            payout[players[1]] = pot;
            emit Result(1, pot);
        } else {
            payout[players[0]] = bet; // tie: split
            payout[players[1]] = bet;
            emit Result(2, pot);
        }
        state = State.Done;
    }

    /// @notice Pull your winnings (reentrancy-safe).
    function claim() external {
        require(state == State.Done, "not done");
        uint256 amount = payout[msg.sender];
        require(amount > 0, "nothing");
        payout[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
    }

    /// @notice Your private card handle (decrypt off-chain).
    function myCardHandle(uint8 seat) external view returns (bytes32) {
        return euint256.unwrap(cards[seat]);
    }
}
